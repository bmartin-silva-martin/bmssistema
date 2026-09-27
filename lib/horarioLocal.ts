export const FUSO_EMPRESA = "America/Sao_Paulo";

export type HorarioLocal = {
  data: string;
  hora: string;
  minutosDoDia: number;
};

const PADRAO_DATA_HORA = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/;
const SUFIXO_FUSO = /T.*(Z|[+-]\d{2}(:?\d{2})?)$/i;

const formatadorLocal = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: FUSO_EMPRESA,
  year: "numeric",
});

// data_agendamento e gravado como "YYYY-MM-DD HH:mm:ss" no horario da empresa, sem fuso.
// O banco pode devolver com sufixo (ex.: "+00:00"), mas os digitos continuam sendo o horario local
// digitado, entao o sufixo e ignorado de proposito. Nao usar new Date(valor) para esse campo.
export function lerHorarioLocal(valor: string | null | undefined): HorarioLocal | null {
  const partes = typeof valor === "string" ? valor.match(PADRAO_DATA_HORA) : null;
  if (!partes) return null;

  const [, ano, mes, dia, hora, minuto] = partes;
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  const dataValida =
    data.getUTCFullYear() === Number(ano) && data.getUTCMonth() === Number(mes) - 1 && data.getUTCDate() === Number(dia);

  if (!dataValida || Number(hora) > 23 || Number(minuto) > 59) return null;

  return { data: `${ano}-${mes}-${dia}`, hora: `${hora}:${minuto}`, minutosDoDia: Number(hora) * 60 + Number(minuto) };
}

export function horarioLocalDoInstante(instante: Date): HorarioLocal {
  const partes = Object.fromEntries(formatadorLocal.formatToParts(instante).map((parte) => [parte.type, parte.value]));

  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}:${partes.minute}`,
    minutosDoDia: Number(partes.hour) * 60 + Number(partes.minute),
  };
}

function comoUtc(local: HorarioLocal) {
  const [ano, mes, dia] = local.data.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia, Math.floor(local.minutosDoDia / 60), local.minutosDoDia % 60);
}

// Instante real (ms) de um horario local da empresa, usando o offset do fuso naquela data.
export function instanteDoHorarioLocal(local: HorarioLocal) {
  const alvo = comoUtc(local);
  let instante = alvo;

  for (let passo = 0; passo < 2; passo += 1) {
    instante += alvo - comoUtc(horarioLocalDoInstante(new Date(instante)));
  }

  return instante;
}

export function minutosAteHorarioLocal(local: HorarioLocal, agora: Date) {
  return (instanteDoHorarioLocal(local) - agora.getTime()) / 60000;
}

// Para colunas com instante real (ex.: created_at default now()). Sem sufixo, o banco usa UTC.
export function lerInstante(valor: string | null | undefined) {
  if (typeof valor !== "string" || !valor.trim()) return null;

  let texto = valor.trim().replace(" ", "T");
  if (/T.*[+-]\d{2}$/.test(texto)) texto = `${texto}:00`;
  if (!SUFIXO_FUSO.test(texto)) texto = `${texto}Z`;

  const ms = Date.parse(texto);
  return Number.isFinite(ms) ? new Date(ms) : null;
}
