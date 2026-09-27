import { horarioLocalDoInstante, lerHorarioLocal, lerInstante, minutosAteHorarioLocal } from "@/lib/horarioLocal";
import type { ResultadoEvolution } from "@/lib/evolutionApi";

export type TipoLembrete = "reminder_day" | "reminder_2h";

export type StatusMensagem = "processando" | "enviado" | "erro" | "incerto" | "falha_definitiva" | "ignorado";

export type ClasseResultadoEnvio = "enviado" | "erro" | "incerto" | "falha_definitiva" | "configuracao";

export const INICIO_LEMBRETE_DIA_MINUTOS = 8 * 60;
export const JANELA_2H_MAXIMO_MINUTOS = 130;
export const JANELA_2H_MINIMO_MINUTOS = 30;
export const MAX_TENTATIVAS = 3;

type AgendamentoParaLembrete = {
  created_at: string | null;
  data_agendamento: string;
  status: string | null;
};

type DadosMensagem = {
  cliente?: string | null;
  empresa?: string | null;
  hora: string;
  profissional?: string | null;
  servico?: string | null;
};

// Regras:
// - reminder_2h: primeira execucao em que faltem entre 30 e 130 minutos.
// - reminder_day: a partir das 08:00 locais, faltando mais de 130 minutos (o 2h cobre o resto),
//   e somente se o agendamento nao foi criado no proprio dia. Sem created_at confiavel, nao envia.
export function tipoLembreteElegivel(agendamento: AgendamentoParaLembrete, agora: Date): TipoLembrete | null {
  if ((agendamento.status || "").toLowerCase() !== "confirmado") return null;

  const horario = lerHorarioLocal(agendamento.data_agendamento);
  if (!horario) return null;

  const agoraLocal = horarioLocalDoInstante(agora);
  if (horario.data !== agoraLocal.data) return null;

  const minutosRestantes = minutosAteHorarioLocal(horario, agora);

  if (minutosRestantes >= JANELA_2H_MINIMO_MINUTOS && minutosRestantes <= JANELA_2H_MAXIMO_MINUTOS) {
    return "reminder_2h";
  }

  if (minutosRestantes <= JANELA_2H_MAXIMO_MINUTOS || agoraLocal.minutosDoDia < INICIO_LEMBRETE_DIA_MINUTOS) {
    return null;
  }

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

export function montarMensagemLembrete(tipo: TipoLembrete, dados: DadosMensagem) {
  const cliente = textoOuVazio(dados.cliente);
  const empresa = textoOuVazio(dados.empresa);
  const servico = textoOuVazio(dados.servico);
  const profissional = textoOuVazio(dados.profissional);
  const saudacao = cliente ? `Olá, ${cliente}!` : "Olá!";
  const detalhes = `${servico ? ` para ${servico}` : ""}${profissional ? `, com ${profissional}` : ""}`;

  if (tipo === "reminder_day") {
    const abertura = empresa
      ? `A ${empresa} lembra que você tem um horário hoje`
      : "Passando para lembrar que você tem um horário agendado hoje";
    return `${saudacao} ${abertura} às ${dados.hora}${detalhes}. Estamos te esperando.`;
  }

  const abertura = empresa ? `A ${empresa} lembra que seu horário é hoje` : "Seu horário é hoje";
  return `${saudacao} ${abertura} às ${dados.hora}${detalhes}. Falta pouco para o seu atendimento. Até já.`;
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
