import { getSupabaseServerClient } from "@/lib/pushReminders";

type ClienteRelation = { nome: string | null; telefone: string | null };
type ServicoRelation = { nome: string | null };

type AgendamentoLembreteRow = {
  id: number;
  data_agendamento: string;
  clientes: ClienteRelation | ClienteRelation[] | null;
  servicos: ServicoRelation | ServicoRelation[] | null;
};

export type WhatsAppReminderResult = {
  configured: boolean;
  details: string[];
  error?: string;
  failed: number;
  sent: number;
  sentAppointmentIds: number[];
};

type EvolutionConfig = {
  apiKey: string;
  baseUrl: string;
  instance: string;
};

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] || null : value;
}

function normalizarTelefoneBrasil(value = "") {
  let digits = value.replace(/\D/g, "");

  while (digits.startsWith("0")) digits = digits.slice(1);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) digits = `55${digits}`;

  return digits;
}

function evolutionConfig(): EvolutionConfig | null {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_API_INSTANCE;

  if (!baseUrl || !apiKey || !instance) return null;

  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), instance };
}

export function isEvolutionConfigured() {
  return evolutionConfig() !== null;
}

async function enviarViaEvolution(config: EvolutionConfig, numero: string, texto: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${config.baseUrl}/message/sendText/${config.instance}`, {
      body: JSON.stringify({ delay: 1200, number: numero, text: texto }),
      headers: { "Content-Type": "application/json", apikey: config.apiKey },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Evolution API respondeu com status ${response.status}.`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Timeout ao enviar lembrete pela Evolution API.");
    }

    throw error instanceof Error ? error : new Error("Falha ao enviar lembrete pela Evolution API.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWhatsAppReminders(empresaId: number, agendamentoIds: number[]): Promise<WhatsAppReminderResult> {
  const config = evolutionConfig();

  if (!config) return { configured: false, details: [], failed: 0, sent: 0, sentAppointmentIds: [] };

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return {
      configured: true,
      details: [],
      error: "Supabase server-only nao configurado.",
      failed: 0,
      sent: 0,
      sentAppointmentIds: [],
    };
  }

  const { data, error } = await supabase
    .from("agendamentos")
    .select("id,data_agendamento,clientes(nome,telefone),servicos(nome)")
    .eq("empresa_id", empresaId)
    .in("id", agendamentoIds);

  if (error) {
    return { configured: true, details: [], error: "Falha ao consultar agendamentos para WhatsApp.", failed: 0, sent: 0, sentAppointmentIds: [] };
  }

  const agendamentos = (data || []) as unknown as AgendamentoLembreteRow[];
  let sent = 0;
  let failed = 0;
  const details: string[] = [];
  const sentAppointmentIds = new Set<number>();

  await Promise.all(
    agendamentos.map(async (agendamento) => {
      const cliente = firstRelation(agendamento.clientes);
      const servico = firstRelation(agendamento.servicos);
      const numero = normalizarTelefoneBrasil(cliente?.telefone || "");
      if (!numero) return;

      const texto = `Ola, ${cliente?.nome || "tudo bem"}! Passando para lembrar seu agendamento de ${servico?.nome || "servico"} em ${new Date(agendamento.data_agendamento).toLocaleString("pt-BR")}.`;

      try {
        await enviarViaEvolution(config, numero, texto);
        sent += 1;
        sentAppointmentIds.add(agendamento.id);
      } catch (sendError) {
        failed += 1;
        details.push(sendError instanceof Error ? sendError.message : "Falha no envio WhatsApp.");
      }
    }),
  );

  return { configured: true, details, failed, sent, sentAppointmentIds: [...sentAppointmentIds] };
}
