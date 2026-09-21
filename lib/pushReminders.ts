import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type PushSubscriptionRow = {
  agendamento_id: number;
  auth: string | null;
  endpoint: string;
  p256dh: string | null;
};

export type PushReminderResult = {
  configured: boolean;
  details: string[];
  failed: number;
  sent: number;
  sentAppointmentIds: number[];
  subscriptions: number;
  error?: string;
};

function configureVapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:contato@bmssistema.com";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export function getSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function sendPushReminders(empresaId: number, agendamentoIds: number[]): Promise<PushReminderResult> {
  const pushConfigured = configureVapid();
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return {
      configured: false,
      details: [],
      error: "Supabase server-only nao configurado.",
      failed: 0,
      sent: 0,
      sentAppointmentIds: [],
      subscriptions: 0,
    };
  }

  if (!pushConfigured) {
    return {
      configured: false,
      details: [],
      error: "Chaves VAPID nao configuradas.",
      failed: 0,
      sent: 0,
      sentAppointmentIds: [],
      subscriptions: 0,
    };
  }

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("agendamento_id,auth,endpoint,p256dh")
    .eq("empresa_id", empresaId)
    .in("agendamento_id", agendamentoIds);

  if (error) {
    return {
      configured: true,
      details: [],
      error: "Falha ao consultar inscricoes push.",
      failed: 0,
      sent: 0,
      sentAppointmentIds: [],
      subscriptions: 0,
    };
  }

  const subscriptions = (data as PushSubscriptionRow[] | null | undefined || []).filter(
    (item) => item.endpoint && item.auth && item.p256dh,
  );
  let sent = 0;
  let failed = 0;
  const details: string[] = [];
  const sentAppointmentIds = new Set<number>();

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              auth: subscription.auth || "",
              p256dh: subscription.p256dh || "",
            },
          },
          JSON.stringify({
            body: "Voce tem um agendamento na barbearia. Confira o horario combinado.",
            tag: "bms-lembrete-agendamento",
            title: "Lembrete de agendamento",
            url: "/agendamentos",
          }),
          { TTL: 86400, urgency: "normal" },
        );

        sent += 1;
        sentAppointmentIds.add(subscription.agendamento_id);
      } catch (error) {
        failed += 1;
        const pushError = error as { statusCode?: number };
        details.push(pushError.statusCode ? `Erro push ${pushError.statusCode}.` : "Falha no envio push.");
      }
    }),
  );

  return {
    configured: true,
    details,
    failed,
    sent,
    sentAppointmentIds: [...sentAppointmentIds],
    subscriptions: subscriptions.length,
  };
}
