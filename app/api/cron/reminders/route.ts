import { NextResponse } from "next/server";
import { getSupabaseServerClient, sendPushReminders } from "@/lib/pushReminders";
import { sendWhatsAppReminders } from "@/lib/evolutionApi";

type AppointmentRow = {
  data_agendamento: string;
  empresa_id: number;
  id: number;
};

const ANTECEDENCIA_PADRAO_MINUTOS = 120;
const JANELA_BUSCA_DIAS = 3;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase server-only nao configurado.", sent: 0 }, { status: 500 });
  }

  const agora = new Date();
  const fimJanela = new Date(agora.getTime() + JANELA_BUSCA_DIAS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id,empresa_id,data_agendamento")
    .eq("aceita_lembrete", true)
    .is("lembrete_enviado_em", null)
    .or("lembrete_status.is.null,lembrete_status.eq.erro")
    .neq("status", "cancelado")
    .neq("status", "concluido")
    .gte("data_agendamento", agora.toISOString())
    .lte("data_agendamento", fimJanela.toISOString());

  if (error) return NextResponse.json({ error: "Falha ao consultar agendamentos.", sent: 0 }, { status: 500 });

  const appointments = ((data || []) as AppointmentRow[]).filter(
    (appointment) => appointment.empresa_id && appointment.id && Number.isFinite(new Date(appointment.data_agendamento).getTime()),
  );
  const byCompany = new Map<number, number[]>();

  for (const appointment of appointments) {
    // lembrete_horario e um horario fixo de configuracao, nao uma antecedencia em minutos.
    // O schema atual nao possui lembrete_antecedencia_minutos; usamos 120 minutos como padrao.
    const inicioJanelaMs = new Date(appointment.data_agendamento).getTime() - ANTECEDENCIA_PADRAO_MINUTOS * 60000;
    if (inicioJanelaMs > agora.getTime()) continue;

    byCompany.set(appointment.empresa_id, [...(byCompany.get(appointment.empresa_id) || []), appointment.id]);
  }

  let sent = 0;
  let failed = 0;
  let subscriptions = 0;
  let whatsappSent = 0;
  let whatsappConfigured = false;
  let failedAppointments = 0;
  let partialAppointments = 0;
  let claimedAppointments = 0;
  const sentAppointmentIds = new Set<number>();

  for (const [empresaId, candidateIds] of byCompany) {
    const claimedIds: number[] = [];

    for (const id of candidateIds) {
      const { data: claimed, error: claimError } = await supabase
        .from("agendamentos")
        .update({ lembrete_status: "processando" })
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .is("lembrete_enviado_em", null)
        .or("lembrete_status.is.null,lembrete_status.eq.erro")
        .select("id");

      if (claimError) {
        return NextResponse.json({ error: "Falha ao reservar agendamentos.", sent: 0 }, { status: 500 });
      }

      if (claimed?.length) claimedIds.push(id);
    }

    if (claimedIds.length === 0) continue;
    claimedAppointments += claimedIds.length;

    let pushResult;
    let whatsappResult;
    try {
      [pushResult, whatsappResult] = await Promise.all([
        sendPushReminders(empresaId, claimedIds),
        sendWhatsAppReminders(empresaId, claimedIds),
      ]);
    } catch {
      await supabase
        .from("agendamentos")
        .update({ lembrete_status: "erro" })
        .eq("empresa_id", empresaId)
        .eq("lembrete_status", "processando")
        .in("id", claimedIds);
      failedAppointments += claimedIds.length;
      continue;
    }

    sent += pushResult.sent + whatsappResult.sent;
    failed += pushResult.failed + whatsappResult.failed;
    subscriptions += pushResult.subscriptions;
    whatsappSent += whatsappResult.sent;
    whatsappConfigured = whatsappConfigured || whatsappResult.configured;

    const pushSent = new Set(pushResult.sentAppointmentIds);
    const whatsappSentIds = new Set(whatsappResult.sentAppointmentIds);
    const idsWhatsapp = claimedIds.filter((id) => whatsappSentIds.has(id));
    const idsPushSomente = claimedIds.filter((id) => pushSent.has(id) && !whatsappSentIds.has(id));
    const idsFalha = claimedIds.filter((id) => !pushSent.has(id) && !whatsappSentIds.has(id));
    const idsParciais = claimedIds.filter(
      (id) => (pushSent.has(id) ? 1 : 0) + (whatsappSentIds.has(id) ? 1 : 0) === 1,
    );

    for (const id of [...idsWhatsapp, ...idsPushSomente]) sentAppointmentIds.add(id);
    failedAppointments += idsFalha.length;
    partialAppointments += idsParciais.length;

    if (idsWhatsapp.length > 0) {
      await supabase
        .from("agendamentos")
        .update({ lembrete_enviado_em: new Date().toISOString(), lembrete_status: "whatsapp_automatico" })
        .eq("empresa_id", empresaId)
        .eq("lembrete_status", "processando")
        .in("id", idsWhatsapp);
    }

    if (idsPushSomente.length > 0) {
      await supabase
        .from("agendamentos")
        .update({ lembrete_enviado_em: new Date().toISOString(), lembrete_status: "push_automatico" })
        .eq("empresa_id", empresaId)
        .eq("lembrete_status", "processando")
        .in("id", idsPushSomente);
    }

    if (idsFalha.length > 0) {
      await supabase
        .from("agendamentos")
        .update({ lembrete_status: "erro" })
        .eq("empresa_id", empresaId)
        .eq("lembrete_status", "processando")
        .in("id", idsFalha);
    }
  }

  return NextResponse.json({
    checked: appointments.length,
    claimedAppointments,
    elegiveisNestaExecucao: [...byCompany.values()].reduce((total, ids) => total + ids.length, 0),
    failed,
    failedAppointments,
    partialAppointments,
    janela: { fim: fimJanela.toISOString(), inicio: agora.toISOString() },
    sent,
    sentAppointmentIds: [...sentAppointmentIds],
    subscriptions,
    whatsappConfigured,
    whatsappSent,
  });
}
