import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultadoEvolution } from "@/lib/evolutionApi";
import { horarioLocalDoInstante, lerHorarioLocal } from "@/lib/horarioLocal";
import {
  classificarResultadoEnvio,
  MAX_TENTATIVAS,
  montarMensagemLembrete,
  type StatusMensagem,
  telefoneWhatsAppValido,
  type TipoLembrete,
  tipoLembreteElegivel,
} from "@/lib/lembretesWhatsApp";

export const PROCESSANDO_TRAVADO_MINUTOS = 10;
const LIMITE_ENVIOS_POR_EXECUCAO = 50;
const ORCAMENTO_EXECUCAO_MS = 45_000;
const FALHAS_SEGUIDAS_PARA_INTERROMPER = 3;

export type AgendamentoCandidato = {
  cliente_nome: string | null;
  cliente_telefone: string | null;
  created_at: string | null;
  data_agendamento: string;
  empresa_id: number;
  id: number;
  profissional_nome: string | null;
  servico_nome: string | null;
  status: string | null;
};

export type MensagemRegistrada = {
  claimed_at: string | null;
  id: number;
  status: StatusMensagem;
  tentativas: number;
};

export type ConclusaoMensagem = {
  enviado_em?: string;
  status: Exclude<StatusMensagem, "processando">;
  tentativas?: number;
  ultimo_erro: string | null;
};

// Toda escrita que reserva uma mensagem precisa ser atomica no banco:
// inserir depende de UNIQUE(agendamento_id, tipo); reivindicar novamente e um compare-and-set.
export type RepositorioLembretes = {
  buscarCandidatos(dataLocal: string): Promise<AgendamentoCandidato[]>;
  buscarMensagem(empresaId: number, agendamentoId: number, tipo: TipoLembrete): Promise<MensagemRegistrada | null>;
  buscarNomesEmpresas(empresaIds: number[]): Promise<Map<number, string>>;
  concluirMensagem(id: number, empresaId: number, conclusao: ConclusaoMensagem): Promise<void>;
  inserirReserva(empresaId: number, agendamentoId: number, tipo: TipoLembrete, agoraIso: string): Promise<number | null>;
  marcarAgendamentoEnviado(agendamentoId: number, empresaId: number, enviadoEm: string): Promise<void>;
  marcarTravadaComoIncerta(id: number, limiteIso: string): Promise<void>;
  reservarNovamente(id: number, esperado: { tentativas: number }, agoraIso: string): Promise<boolean>;
};

export type ResumoLembretes = {
  elegiveis: number;
  enviados: number;
  erros: number;
  falhasDefinitivas: number;
  ignorados: number;
  incertos: number;
  interrompido: null | "configuracao" | "indisponivel" | "limite";
  jaProcessados: number;
  pushAgendamentos: number;
  statusConfiguracao?: number;
  verificados: number;
};

type OpcoesProcessamento = {
  agora: Date;
  enviar: (numero: string, texto: string) => Promise<ResultadoEvolution>;
  enviarPush?: (empresaId: number, agendamentoIds: number[]) => Promise<unknown>;
  limiteEnvios?: number;
  orcamentoMs?: number;
  relogio?: () => number;
  repositorio: RepositorioLembretes;
};

async function reservar(
  repositorio: RepositorioLembretes,
  agendamento: AgendamentoCandidato,
  tipo: TipoLembrete,
  agora: Date,
) {
  const agoraIso = agora.toISOString();
  const novoId = await repositorio.inserirReserva(agendamento.empresa_id, agendamento.id, tipo, agoraIso);
  if (novoId !== null) return { id: novoId, tentativas: 1 };

  const existente = await repositorio.buscarMensagem(agendamento.empresa_id, agendamento.id, tipo);
  if (!existente) return null;

  if (existente.status === "erro" && existente.tentativas < MAX_TENTATIVAS) {
    const reservada = await repositorio.reservarNovamente(existente.id, { tentativas: existente.tentativas }, agoraIso);
    return reservada ? { id: existente.id, tentativas: existente.tentativas + 1 } : null;
  }

  // Processando por mais de 10 min = execucao morreu entre reservar e concluir. Como o envio e feito
  // logo apos a reserva, a mensagem pode ter saido: vira "incerto" e nao e reenviada automaticamente.
  const limite = new Date(agora.getTime() - PROCESSANDO_TRAVADO_MINUTOS * 60000);
  if (existente.status === "processando" && existente.claimed_at && new Date(existente.claimed_at) < limite) {
    await repositorio.marcarTravadaComoIncerta(existente.id, limite.toISOString());
  }

  return null;
}

export async function processarLembretesAutomaticos(opcoes: OpcoesProcessamento): Promise<ResumoLembretes> {
  const { agora, enviar, enviarPush, repositorio } = opcoes;
  const limiteEnvios = opcoes.limiteEnvios ?? LIMITE_ENVIOS_POR_EXECUCAO;
  const orcamentoMs = opcoes.orcamentoMs ?? ORCAMENTO_EXECUCAO_MS;
  const relogio = opcoes.relogio ?? Date.now;
  const inicio = relogio();

  const candidatos = await repositorio.buscarCandidatos(horarioLocalDoInstante(agora).data);
  const elegiveis = candidatos
    .map((agendamento) => ({ agendamento, tipo: tipoLembreteElegivel(agendamento, agora) }))
    .filter((item): item is { agendamento: AgendamentoCandidato; tipo: TipoLembrete } => item.tipo !== null)
    .sort((a, b) => a.agendamento.data_agendamento.localeCompare(b.agendamento.data_agendamento));

  const resumo: ResumoLembretes = {
    elegiveis: elegiveis.length,
    enviados: 0,
    erros: 0,
    falhasDefinitivas: 0,
    ignorados: 0,
    incertos: 0,
    interrompido: null,
    jaProcessados: 0,
    pushAgendamentos: 0,
    verificados: candidatos.length,
  };
  if (elegiveis.length === 0) return resumo;

  const nomesEmpresas = await repositorio.buscarNomesEmpresas([...new Set(elegiveis.map((item) => item.agendamento.empresa_id))]);
  const pushPorEmpresa = new Map<number, number[]>();
  let reservas = 0;
  let falhasSeguidas = 0;

  for (const { agendamento, tipo } of elegiveis) {
    if (reservas >= limiteEnvios || relogio() - inicio > orcamentoMs) {
      resumo.interrompido = "limite";
      break;
    }

    try {
      const reserva = await reservar(repositorio, agendamento, tipo, agora);
      if (!reserva) {
        resumo.jaProcessados += 1;
        continue;
      }
      reservas += 1;

      // Push acompanha o lembrete de 2h uma unica vez (na primeira reserva), independente do WhatsApp.
      if (tipo === "reminder_2h" && reserva.tentativas === 1) {
        pushPorEmpresa.set(agendamento.empresa_id, [...(pushPorEmpresa.get(agendamento.empresa_id) || []), agendamento.id]);
      }

      const numero = telefoneWhatsAppValido(agendamento.cliente_telefone);
      if (!numero) {
        await repositorio.concluirMensagem(reserva.id, agendamento.empresa_id, { status: "ignorado", ultimo_erro: "Telefone invalido." });
        resumo.ignorados += 1;
        continue;
      }

      const texto = montarMensagemLembrete(tipo, {
        cliente: agendamento.cliente_nome,
        empresa: nomesEmpresas.get(agendamento.empresa_id),
        hora: lerHorarioLocal(agendamento.data_agendamento)?.hora || "",
        profissional: agendamento.profissional_nome,
        servico: agendamento.servico_nome,
      });

      const resultado = await enviar(numero, texto).catch((): ResultadoEvolution => ({ tipo: "rede" }));
      const classe = classificarResultadoEnvio(resultado);
      const detalhe = resultado.tipo === "http" ? `HTTP ${resultado.status}.` : resultado.tipo === "ok" ? null : `Falha: ${resultado.tipo}.`;

      if (classe === "enviado") {
        const enviadoEm = new Date().toISOString();
        await repositorio.concluirMensagem(reserva.id, agendamento.empresa_id, { enviado_em: enviadoEm, status: "enviado", ultimo_erro: null });
        await repositorio.marcarAgendamentoEnviado(agendamento.id, agendamento.empresa_id, enviadoEm);
        resumo.enviados += 1;
        falhasSeguidas = 0;
        continue;
      }

      if (classe === "configuracao") {
        // Chave/instancia errada afeta todos: devolve a tentativa e para a execucao.
        await repositorio.concluirMensagem(reserva.id, agendamento.empresa_id, {
          status: "erro",
          tentativas: reserva.tentativas - 1,
          ultimo_erro: `Configuracao Evolution recusada (${detalhe})`,
        });
        resumo.interrompido = "configuracao";
        resumo.statusConfiguracao = resultado.tipo === "http" ? resultado.status : undefined;
        break;
      }

      if (classe === "incerto") {
        await repositorio.concluirMensagem(reserva.id, agendamento.empresa_id, { status: "incerto", ultimo_erro: detalhe });
        resumo.incertos += 1;
      } else if (classe === "falha_definitiva" || reserva.tentativas >= MAX_TENTATIVAS) {
        await repositorio.concluirMensagem(reserva.id, agendamento.empresa_id, { status: "falha_definitiva", ultimo_erro: detalhe });
        resumo.falhasDefinitivas += 1;
      } else {
        await repositorio.concluirMensagem(reserva.id, agendamento.empresa_id, { status: "erro", ultimo_erro: detalhe });
        resumo.erros += 1;
      }

      falhasSeguidas = classe === "falha_definitiva" ? 0 : falhasSeguidas + 1;
      if (falhasSeguidas >= FALHAS_SEGUIDAS_PARA_INTERROMPER) {
        resumo.interrompido = "indisponivel";
        break;
      }
    } catch {
      // Falha de banco em um agendamento nao impede os demais.
      resumo.erros += 1;
    }
  }

  if (enviarPush) {
    for (const [empresaId, ids] of pushPorEmpresa) {
      try {
        await enviarPush(empresaId, ids);
        resumo.pushAgendamentos += ids.length;
      } catch {
        // Push e complementar; falha nao altera o estado do WhatsApp.
      }
    }
  }

  return resumo;
}

type Relacao<T> = T | T[] | null;

type AgendamentoLinha = {
  clientes: Relacao<{ nome: string | null; telefone: string | null }>;
  created_at: string | null;
  data_agendamento: string;
  empresa_id: number;
  id: number;
  profissionais: Relacao<{ nome: string | null }>;
  servicos: Relacao<{ nome: string | null }>;
  status: string | null;
};

function primeira<T>(valor: Relacao<T>) {
  return Array.isArray(valor) ? valor[0] || null : valor;
}

export function criarRepositorioSupabase(supabase: SupabaseClient): RepositorioLembretes {
  return {
    async buscarCandidatos(dataLocal) {
      // Mesmo formato sem fuso usado na gravacao, para o banco comparar no mesmo referencial.
      const { data, error } = await supabase
        .from("agendamentos")
        .select("id,empresa_id,data_agendamento,created_at,status,clientes(nome,telefone),servicos(nome),profissionais(nome)")
        .eq("aceita_lembrete", true)
        .eq("status", "confirmado")
        .gte("data_agendamento", `${dataLocal} 00:00:00`)
        .lte("data_agendamento", `${dataLocal} 23:59:59`)
        .order("data_agendamento");

      if (error) throw new Error("Falha ao consultar agendamentos.");

      return ((data || []) as unknown as AgendamentoLinha[]).map((linha) => ({
        cliente_nome: primeira(linha.clientes)?.nome ?? null,
        cliente_telefone: primeira(linha.clientes)?.telefone ?? null,
        created_at: linha.created_at,
        data_agendamento: linha.data_agendamento,
        empresa_id: linha.empresa_id,
        id: linha.id,
        profissional_nome: primeira(linha.profissionais)?.nome ?? null,
        servico_nome: primeira(linha.servicos)?.nome ?? null,
        status: linha.status,
      }));
    },

    async buscarMensagem(empresaId, agendamentoId, tipo) {
      const { data, error } = await supabase
        .from("mensagens_whatsapp")
        .select("id,status,tentativas,claimed_at")
        .eq("empresa_id", empresaId)
        .eq("agendamento_id", agendamentoId)
        .eq("tipo", tipo)
        .maybeSingle();

      if (error) throw new Error("Falha ao consultar mensagem.");
      return data as MensagemRegistrada | null;
    },

    async buscarNomesEmpresas(empresaIds) {
      const { data, error } = await supabase.from("empresas").select("id,nome").in("id", empresaIds);
      if (error) throw new Error("Falha ao consultar empresas.");

      return new Map(((data || []) as { id: number; nome: string | null }[]).filter((empresa) => empresa.nome).map((empresa) => [empresa.id, empresa.nome as string]));
    },

    async concluirMensagem(id, empresaId, conclusao) {
      const { error } = await supabase
        .from("mensagens_whatsapp")
        .update(conclusao)
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .eq("status", "processando");

      if (error) throw new Error("Falha ao concluir mensagem.");
    },

    async inserirReserva(empresaId, agendamentoId, tipo, agoraIso) {
      const { data, error } = await supabase
        .from("mensagens_whatsapp")
        .insert({ agendamento_id: agendamentoId, claimed_at: agoraIso, empresa_id: empresaId, status: "processando", tentativas: 1, tipo })
        .select("id")
        .single();

      if (error?.code === "23505") return null;
      if (error || !data) throw new Error("Falha ao reservar mensagem.");
      return (data as { id: number }).id;
    },

    async marcarAgendamentoEnviado(agendamentoId, empresaId, enviadoEm) {
      // Compatibilidade com a UI atual; a duplicidade e controlada por mensagens_whatsapp.
      await supabase
        .from("agendamentos")
        .update({ lembrete_enviado_em: enviadoEm, lembrete_status: "whatsapp_automatico" })
        .eq("id", agendamentoId)
        .eq("empresa_id", empresaId)
        .is("lembrete_enviado_em", null);
    },

    async marcarTravadaComoIncerta(id, limiteIso) {
      await supabase
        .from("mensagens_whatsapp")
        .update({ status: "incerto", ultimo_erro: "Processamento interrompido." })
        .eq("id", id)
        .eq("status", "processando")
        .lt("claimed_at", limiteIso);
    },

    async reservarNovamente(id, esperado, agoraIso) {
      const { data, error } = await supabase
        .from("mensagens_whatsapp")
        .update({ claimed_at: agoraIso, status: "processando", tentativas: esperado.tentativas + 1 })
        .eq("id", id)
        .eq("status", "erro")
        .eq("tentativas", esperado.tentativas)
        .select("id");

      if (error) throw new Error("Falha ao reservar mensagem novamente.");
      return Boolean(data?.length);
    },
  };
}
