import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultadoEvolution } from "@/lib/evolutionApi";
import { horarioLocalDoInstante, lerHorarioLocal, lerInstante } from "@/lib/horarioLocal";
import {
  type ClasseResultadoEnvio,
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

export type Canal = "whatsapp" | "push";

export type AgendamentoCandidato = {
  aceita_lembrete: boolean | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  created_at: string | null;
  data_agendamento: string;
  empresa_id: number;
  id: number;
  profissional_nome: string | null;
  servico_nome: string | null;
  status: string | null;
  ultimo_manual_em: string | null;
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

export type ResultadoPush = "enviado" | "sem_inscricao" | "erro";

// Toda escrita que reserva uma mensagem precisa ser atomica no banco:
// inserir depende do indice unico (agendamento_id, tipo, canal); reivindicar novamente e um compare-and-set.
export type RepositorioLembretes = {
  buscarAgendamentosComPush(empresaId: number, agendamentoIds: number[]): Promise<Set<number>>;
  buscarCandidatos(dataLocal: string): Promise<AgendamentoCandidato[]>;
  buscarMensagem(empresaId: number, agendamentoId: number, tipo: TipoLembrete, canal: Canal): Promise<MensagemRegistrada | null>;
  buscarNomesEmpresas(empresaIds: number[]): Promise<Map<number, string>>;
  concluirMensagem(id: number, empresaId: number, conclusao: ConclusaoMensagem): Promise<void>;
  inserirReserva(empresaId: number, agendamentoId: number, tipo: TipoLembrete, canal: Canal, agoraIso: string): Promise<number | null>;
  marcarAgendamentoEnviado(agendamentoId: number, empresaId: number, enviadoEm: string): Promise<void>;
  marcarTravadaComoIncerta(id: number, limiteIso: string): Promise<void>;
  reservarNovamente(id: number, esperado: { tentativas: number }, agoraIso: string): Promise<boolean>;
};

export type ResumoCanal = {
  ativo: boolean;
  elegiveis: number;
  enviados: number;
  erros: number;
  falhasDefinitivas: number;
  ignorados: number;
  incertos: number;
  interrompido: null | "configuracao" | "indisponivel" | "limite" | "falha_consulta";
  jaProcessados: number;
  statusConfiguracao?: number;
};

export type ResumoLembretes = {
  elegiveis: number;
  push: ResumoCanal;
  verificados: number;
  whatsapp: ResumoCanal;
};

type OpcoesProcessamento = {
  agora: Date;
  // Canal ausente = nao configurado; o outro canal segue normalmente.
  enviar?: (numero: string, texto: string) => Promise<ResultadoEvolution>;
  enviarPush?: (empresaId: number, agendamentoId: number) => Promise<ResultadoPush>;
  limiteEnvios?: number;
  orcamentoMs?: number;
  relogio?: () => number;
  repositorio: RepositorioLembretes;
};

type Item = { agendamento: AgendamentoCandidato; tipo: TipoLembrete };

type Entrega = { classe: ClasseResultadoEnvio | "ignorado"; detalhe: string | null; statusHttp?: number };

function resumoVazio(ativo: boolean): ResumoCanal {
  return {
    ativo,
    elegiveis: 0,
    enviados: 0,
    erros: 0,
    falhasDefinitivas: 0,
    ignorados: 0,
    incertos: 0,
    interrompido: null,
    jaProcessados: 0,
  };
}

async function reservar(repositorio: RepositorioLembretes, item: Item, canal: Canal, agora: Date) {
  const { agendamento, tipo } = item;
  const agoraIso = agora.toISOString();
  const novoId = await repositorio.inserirReserva(agendamento.empresa_id, agendamento.id, tipo, canal, agoraIso);
  if (novoId !== null) return { id: novoId, tentativas: 1 };

  const existente = await repositorio.buscarMensagem(agendamento.empresa_id, agendamento.id, tipo, canal);
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

async function processarCanal(
  canal: Canal,
  itens: Item[],
  entregar: (item: Item) => Promise<Entrega>,
  aoEnviar: ((item: Item, enviadoEm: string) => Promise<void>) | null,
  opcoes: OpcoesProcessamento,
): Promise<ResumoCanal> {
  const { agora, repositorio } = opcoes;
  const limiteEnvios = opcoes.limiteEnvios ?? LIMITE_ENVIOS_POR_EXECUCAO;
  const orcamentoMs = opcoes.orcamentoMs ?? ORCAMENTO_EXECUCAO_MS;
  const relogio = opcoes.relogio ?? Date.now;
  const inicio = relogio();
  const resumo = { ...resumoVazio(true), elegiveis: itens.length };
  let reservas = 0;
  let falhasSeguidas = 0;

  for (const item of itens) {
    if (reservas >= limiteEnvios || relogio() - inicio > orcamentoMs) {
      resumo.interrompido = "limite";
      break;
    }

    try {
      const reserva = await reservar(repositorio, item, canal, agora);
      if (!reserva) {
        resumo.jaProcessados += 1;
        continue;
      }
      reservas += 1;

      const empresaId = item.agendamento.empresa_id;
      const { classe, detalhe, statusHttp } = await entregar(item).catch((): Entrega => ({ classe: "erro", detalhe: "Falha: rede." }));

      if (classe === "enviado") {
        const enviadoEm = new Date().toISOString();
        await repositorio.concluirMensagem(reserva.id, empresaId, { enviado_em: enviadoEm, status: "enviado", ultimo_erro: null });
        if (aoEnviar) await aoEnviar(item, enviadoEm);
        resumo.enviados += 1;
        falhasSeguidas = 0;
        continue;
      }

      if (classe === "ignorado") {
        await repositorio.concluirMensagem(reserva.id, empresaId, { status: "ignorado", ultimo_erro: detalhe });
        resumo.ignorados += 1;
        continue;
      }

      if (classe === "configuracao") {
        // Chave/instancia errada afeta todos: devolve a tentativa e para este canal.
        await repositorio.concluirMensagem(reserva.id, empresaId, {
          status: "erro",
          tentativas: reserva.tentativas - 1,
          ultimo_erro: `Configuracao recusada (${detalhe})`,
        });
        resumo.interrompido = "configuracao";
        resumo.statusConfiguracao = statusHttp;
        break;
      }

      if (classe === "incerto") {
        await repositorio.concluirMensagem(reserva.id, empresaId, { status: "incerto", ultimo_erro: detalhe });
        resumo.incertos += 1;
      } else if (classe === "falha_definitiva" || reserva.tentativas >= MAX_TENTATIVAS) {
        await repositorio.concluirMensagem(reserva.id, empresaId, { status: "falha_definitiva", ultimo_erro: detalhe });
        resumo.falhasDefinitivas += 1;
      } else {
        await repositorio.concluirMensagem(reserva.id, empresaId, { status: "erro", ultimo_erro: detalhe });
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

  return resumo;
}

async function processarWhatsApp(itens: Item[], opcoes: OpcoesProcessamento): Promise<ResumoCanal> {
  const { enviar, repositorio } = opcoes;
  if (!enviar) return resumoVazio(false);
  if (itens.length === 0) return resumoVazio(true);

  let nomesEmpresas: Map<number, string>;
  try {
    nomesEmpresas = await repositorio.buscarNomesEmpresas([...new Set(itens.map((item) => item.agendamento.empresa_id))]);
  } catch {
    return { ...resumoVazio(true), elegiveis: itens.length, interrompido: "falha_consulta" };
  }

  const entregar = async ({ agendamento, tipo }: Item): Promise<Entrega> => {
    const numero = telefoneWhatsAppValido(agendamento.cliente_telefone);
    if (!numero) return { classe: "ignorado", detalhe: "Telefone invalido." };

    const texto = montarMensagemLembrete(tipo, {
      cliente: agendamento.cliente_nome,
      empresa: nomesEmpresas.get(agendamento.empresa_id),
      hora: lerHorarioLocal(agendamento.data_agendamento)?.hora || "",
      profissional: agendamento.profissional_nome,
      servico: agendamento.servico_nome,
    });

    const resultado = await enviar(numero, texto).catch((): ResultadoEvolution => ({ tipo: "rede" }));
    const detalhe = resultado.tipo === "http" ? `HTTP ${resultado.status}.` : resultado.tipo === "ok" ? null : `Falha: ${resultado.tipo}.`;
    return { classe: classificarResultadoEnvio(resultado), detalhe, statusHttp: resultado.tipo === "http" ? resultado.status : undefined };
  };

  // Compatibilidade com a UI atual; a duplicidade e controlada por mensagens_whatsapp.
  const aoEnviar = ({ agendamento }: Item, enviadoEm: string) =>
    repositorio.marcarAgendamentoEnviado(agendamento.id, agendamento.empresa_id, enviadoEm);

  return processarCanal("whatsapp", itens, entregar, aoEnviar, opcoes);
}

async function processarPush(itens: Item[], opcoes: OpcoesProcessamento): Promise<ResumoCanal> {
  const { enviarPush, repositorio } = opcoes;
  if (!enviarPush) return resumoVazio(false);

  // Reserva apenas quem tem inscricao push, para nao criar uma linha "ignorado" por agendamento.
  const comPush: Item[] = [];
  try {
    const porEmpresa = new Map<number, Item[]>();
    for (const item of itens) porEmpresa.set(item.agendamento.empresa_id, [...(porEmpresa.get(item.agendamento.empresa_id) || []), item]);

    for (const [empresaId, itensEmpresa] of porEmpresa) {
      const inscritos = await repositorio.buscarAgendamentosComPush(empresaId, itensEmpresa.map((item) => item.agendamento.id));
      comPush.push(...itensEmpresa.filter((item) => inscritos.has(item.agendamento.id)));
    }
  } catch {
    return { ...resumoVazio(true), elegiveis: itens.length, interrompido: "falha_consulta" };
  }

  const entregar = async ({ agendamento }: Item): Promise<Entrega> => {
    const resultado = await enviarPush(agendamento.empresa_id, agendamento.id);
    if (resultado === "enviado") return { classe: "enviado", detalhe: null };
    if (resultado === "sem_inscricao") return { classe: "ignorado", detalhe: "Sem inscricao push valida." };
    return { classe: "erro", detalhe: "Falha no envio push." };
  };

  return processarCanal("push", comPush, entregar, null, opcoes);
}

export async function processarLembretesAutomaticos(opcoes: OpcoesProcessamento): Promise<ResumoLembretes> {
  const { agora, repositorio } = opcoes;

  const candidatos = await repositorio.buscarCandidatos(horarioLocalDoInstante(agora).data);
  const itens = candidatos
    .map((agendamento) => ({ agendamento, tipo: tipoLembreteElegivel(agendamento, agora) }))
    .filter((item): item is Item => item.tipo !== null)
    .sort((a, b) => a.agendamento.data_agendamento.localeCompare(b.agendamento.data_agendamento));

  // Canais independentes: rodam em paralelo e um nao interrompe o outro.
  const [whatsapp, push] = await Promise.all([
    processarWhatsApp(itens, opcoes).catch(() => ({ ...resumoVazio(true), interrompido: "falha_consulta" as const })),
    processarPush(itens, opcoes).catch(() => ({ ...resumoVazio(true), interrompido: "falha_consulta" as const })),
  ]);

  return { elegiveis: itens.length, push, verificados: candidatos.length, whatsapp };
}

type Relacao<T> = T | T[] | null;

type AgendamentoLinha = {
  aceita_lembrete: boolean | null;
  clientes: Relacao<{ nome: string | null; telefone: string | null }>;
  created_at: string | null;
  data_agendamento: string;
  empresa_id: number;
  id: number;
  lembrete_enviado_em: string | null;
  lembrete_status: string | null;
  profissionais: Relacao<{ nome: string | null }>;
  servicos: Relacao<{ nome: string | null }>;
  status: string | null;
};

function primeira<T>(valor: Relacao<T>) {
  return Array.isArray(valor) ? valor[0] || null : valor;
}

function maisRecente(...valores: (string | null | undefined)[]) {
  const instantes = valores.map((valor) => lerInstante(valor)).filter((valor): valor is Date => valor !== null);
  if (instantes.length === 0) return null;
  return new Date(Math.max(...instantes.map((valor) => valor.getTime()))).toISOString();
}

export function criarRepositorioSupabase(supabase: SupabaseClient): RepositorioLembretes {
  return {
    async buscarAgendamentosComPush(empresaId, agendamentoIds) {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("agendamento_id")
        .eq("empresa_id", empresaId)
        .in("agendamento_id", agendamentoIds);

      if (error) throw new Error("Falha ao consultar inscricoes push.");
      return new Set(((data || []) as { agendamento_id: number }[]).map((linha) => linha.agendamento_id));
    },

    async buscarCandidatos(dataLocal) {
      // Mesmo formato sem fuso usado na gravacao, para o banco comparar no mesmo referencial.
      const { data, error } = await supabase
        .from("agendamentos")
        .select(
          "id,empresa_id,data_agendamento,created_at,status,aceita_lembrete,lembrete_enviado_em,lembrete_status,clientes(nome,telefone),servicos(nome),profissionais(nome)",
        )
        .eq("aceita_lembrete", true)
        .eq("status", "confirmado")
        .gte("data_agendamento", `${dataLocal} 00:00:00`)
        .lte("data_agendamento", `${dataLocal} 23:59:59`)
        .order("data_agendamento");

      if (error) throw new Error("Falha ao consultar agendamentos.");
      const linhas = (data || []) as unknown as AgendamentoLinha[];
      if (linhas.length === 0) return [];

      const { data: manuais, error: manuaisError } = await supabase
        .from("mensagens_whatsapp")
        .select("agendamento_id,enviado_em")
        .eq("tipo", "manual_reminder")
        .eq("status", "enviado")
        .in("agendamento_id", linhas.map((linha) => linha.id));

      if (manuaisError) throw new Error("Falha ao consultar lembretes manuais.");
      const manualPorAgendamento = new Map<number, string | null>();
      for (const manual of (manuais || []) as { agendamento_id: number; enviado_em: string | null }[]) {
        manualPorAgendamento.set(manual.agendamento_id, maisRecente(manualPorAgendamento.get(manual.agendamento_id), manual.enviado_em));
      }

      return linhas.map((linha) => ({
        aceita_lembrete: linha.aceita_lembrete,
        cliente_nome: primeira(linha.clientes)?.nome ?? null,
        cliente_telefone: primeira(linha.clientes)?.telefone ?? null,
        created_at: linha.created_at,
        data_agendamento: linha.data_agendamento,
        empresa_id: linha.empresa_id,
        id: linha.id,
        profissional_nome: primeira(linha.profissionais)?.nome ?? null,
        servico_nome: primeira(linha.servicos)?.nome ?? null,
        status: linha.status,
        // "enviado" e gravado somente pelo painel (inclusive no link wa.me, que nao passa pelo servidor).
        ultimo_manual_em: maisRecente(
          manualPorAgendamento.get(linha.id),
          linha.lembrete_status === "enviado" ? linha.lembrete_enviado_em : null,
        ),
      }));
    },

    async buscarMensagem(empresaId, agendamentoId, tipo, canal) {
      const { data, error } = await supabase
        .from("mensagens_whatsapp")
        .select("id,status,tentativas,claimed_at")
        .eq("empresa_id", empresaId)
        .eq("agendamento_id", agendamentoId)
        .eq("tipo", tipo)
        .eq("canal", canal)
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

    async inserirReserva(empresaId, agendamentoId, tipo, canal, agoraIso) {
      const { data, error } = await supabase
        .from("mensagens_whatsapp")
        .insert({ agendamento_id: agendamentoId, canal, claimed_at: agoraIso, empresa_id: empresaId, status: "processando", tentativas: 1, tipo })
        .select("id")
        .single();

      if (error?.code === "23505") return null;
      if (error || !data) throw new Error("Falha ao reservar mensagem.");
      return (data as { id: number }).id;
    },

    async marcarAgendamentoEnviado(agendamentoId, empresaId, enviadoEm) {
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
