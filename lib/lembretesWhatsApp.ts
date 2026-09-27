import { horarioLocalDoInstante, lerHorarioLocal, lerInstante, minutosAteHorarioLocal } from "@/lib/horarioLocal";
import type { ResultadoEvolution } from "@/lib/evolutionApi";

export type TipoLembrete = "reminder_day" | "reminder_2h";

export type TipoMensagem = TipoLembrete | "manual_reminder";

export type StatusMensagem = "processando" | "enviado" | "erro" | "incerto" | "falha_definitiva" | "ignorado";

export type ClasseResultadoEnvio = "enviado" | "erro" | "incerto" | "falha_definitiva" | "configuracao";

export const INICIO_LEMBRETE_DIA_MINUTOS = 8 * 60;
export const JANELA_2H_MAXIMO_MINUTOS = 130;
export const JANELA_2H_MINIMO_MINUTOS = 30;
export const INTERVALO_MINIMO_ENTRE_LEMBRETES_MINUTOS = 90;
// reminder_2h sai no maximo 130 min antes; o do dia precisa sair pelo menos 90 min antes disso.
export const LEMBRETE_DIA_MINIMO_MINUTOS = JANELA_2H_MAXIMO_MINUTOS + INTERVALO_MINIMO_ENTRE_LEMBRETES_MINUTOS;
export const MAX_TENTATIVAS = 3;

type AgendamentoParaLembrete = {
  aceita_lembrete: boolean | null;
  created_at: string | null;
  data_agendamento: string;
  status: string | null;
  ultimo_manual_em?: string | null;
};

type DadosMensagem = {
  cliente?: string | null;
  empresa?: string | null;
  hora: string;
  profissional?: string | null;
  // Apenas manual_reminder: "hoje", "amanhã" ou "no dia 28/09".
  quando?: string;
  servico?: string | null;
};

// Regras:
// - somente aceita_lembrete = true e status "confirmado", no dia local do agendamento;
// - lembrete manual nos ultimos 90 min bloqueia qualquer automatico (e o do dia, se foi hoje);
// - reminder_2h (prioritario): primeira execucao em que faltem entre 30 e 130 minutos;
// - reminder_day: a partir das 08:00 locais, faltando >= 220 min (90 min antes do 2h),
//   e somente se o agendamento nao foi criado no proprio dia. Sem created_at confiavel, nao envia.
export function tipoLembreteElegivel(agendamento: AgendamentoParaLembrete, agora: Date): TipoLembrete | null {
  if (agendamento.aceita_lembrete !== true) return null;
  if ((agendamento.status || "").toLowerCase() !== "confirmado") return null;

  const horario = lerHorarioLocal(agendamento.data_agendamento);
  if (!horario) return null;

  const agoraLocal = horarioLocalDoInstante(agora);
  if (horario.data !== agoraLocal.data) return null;

  const manualEm = lerInstante(agendamento.ultimo_manual_em);
  if (manualEm && agora.getTime() - manualEm.getTime() < INTERVALO_MINIMO_ENTRE_LEMBRETES_MINUTOS * 60000) return null;

  const minutosRestantes = minutosAteHorarioLocal(horario, agora);

  if (minutosRestantes >= JANELA_2H_MINIMO_MINUTOS && minutosRestantes <= JANELA_2H_MAXIMO_MINUTOS) {
    return "reminder_2h";
  }

  if (minutosRestantes < LEMBRETE_DIA_MINIMO_MINUTOS || agoraLocal.minutosDoDia < INICIO_LEMBRETE_DIA_MINUTOS) {
    return null;
  }

  if (manualEm && horarioLocalDoInstante(manualEm).data === agoraLocal.data) return null;

  const criadoEm = lerInstante(agendamento.created_at);
  if (!criadoEm || horarioLocalDoInstante(criadoEm).data === agoraLocal.data) return null;

  return "reminder_day";
}

export function telefoneWhatsAppValido(telefone: string | null | undefined) {
  let digitos = (telefone || "").replace(/\D/g, "");

  while (digitos.startsWith("0")) digitos = digitos.slice(1);
  if ((digitos.length === 10 || digitos.length === 11) && !digitos.startsWith("55")) digitos = `55${digitos}`;

  return /^55\d{10,11}$/.test(digitos) ? digitos : null;
}

function textoOuVazio(valor: string | null | undefined) {
  return typeof valor === "string" ? valor.trim() : "";
}

export function descreverDiaRelativo(dataAgendamento: string, agora: Date) {
  const hoje = horarioLocalDoInstante(agora).data;
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const amanha = new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);

  if (dataAgendamento === hoje) return "hoje";
  if (dataAgendamento === amanha) return "amanhã";
  return `no dia ${dataAgendamento.slice(8, 10)}/${dataAgendamento.slice(5, 7)}`;
}

export function montarMensagemLembrete(tipo: TipoMensagem, dados: DadosMensagem) {
  const cliente = textoOuVazio(dados.cliente);
  const empresa = textoOuVazio(dados.empresa);
  const servico = textoOuVazio(dados.servico);
  const profissional = textoOuVazio(dados.profissional);
  const saudacao = cliente ? `Olá, ${cliente}!` : "Olá!";
  const detalhes = `${servico ? ` para ${servico}` : ""}${profissional ? `, com ${profissional}` : ""}`;

  if (tipo === "reminder_2h") {
    const abertura = empresa ? `A ${empresa} lembra que seu horário é hoje` : "Seu horário é hoje";
    return `${saudacao} ${abertura} às ${dados.hora}${detalhes}. Falta pouco para o seu atendimento. Até já.`;
  }

  const quando = tipo === "manual_reminder" ? dados.quando || "hoje" : "hoje";
  const abertura = empresa
    ? `A ${empresa} lembra que você tem um horário ${quando}`
    : `Passando para lembrar que você tem um horário agendado ${quando}`;
  return `${saudacao} ${abertura} às ${dados.hora}${detalhes}. Estamos te esperando.`;
}

// Texto do lembrete manual (servidor e link wa.me do painel usam o mesmo).
export function montarMensagemManual(
  agendamento: { data_agendamento: string },
  dados: Omit<DadosMensagem, "hora" | "quando">,
  agora = new Date(),
) {
  const horario = lerHorarioLocal(agendamento.data_agendamento);
  if (!horario) return null;

  return montarMensagemLembrete("manual_reminder", {
    ...dados,
    hora: horario.hora,
    quando: descreverDiaRelativo(horario.data, agora),
  });
}

export function classificarResultadoEnvio(resultado: ResultadoEvolution): ClasseResultadoEnvio {
  if (resultado.tipo === "ok") return "enviado";
  if (resultado.tipo === "timeout") return "incerto";
  if (resultado.tipo === "rede") return "erro";

  const { status } = resultado;
  if (status === 401 || status === 403 || status === 404) return "configuracao";
  if (status === 408 || status === 429 || status >= 500) return "erro";
  if (status >= 400) return "falha_definitiva";
  return "erro";
}
