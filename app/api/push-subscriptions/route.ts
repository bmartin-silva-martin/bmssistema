import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PushKeys = {
  auth?: string;
  p256dh?: string;
};

type PushSubscriptionPayload = {
  endpoint?: string;
  keys?: PushKeys;
};

type SubscriptionRequest = {
  agendamentoId?: number;
  clienteId?: number;
  empresaId?: number;
  subscription?: PushSubscriptionPayload;
};

function getSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as SubscriptionRequest;
  const subscription = body.subscription;

  if (!body.empresaId || !body.clienteId || !body.agendamentoId || !subscription?.endpoint) {
    return NextResponse.json({ error: "Dados da inscricao incompletos." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase nao configurado no servidor." }, { status: 500 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      agendamento_id: body.agendamentoId,
      auth: subscription.keys?.auth || null,
      cliente_id: body.clienteId,
      endpoint: subscription.endpoint,
      empresa_id: body.empresaId,
      p256dh: subscription.keys?.p256dh || null,
      user_agent: request.headers.get("user-agent"),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
