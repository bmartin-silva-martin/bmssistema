import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PushSubscriptionRow = {
  endpoint: string;
};

type ReminderRequest = {
  agendamentoIds?: number[];
  empresaId?: number;
};

function base64Url(input: Buffer | string) {
  const value = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input).toString("base64");
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="), "base64");
}

function derToJose(signature: Buffer) {
  let offset = 3;
  let rLength = signature[offset - 1];

  if (rLength === 33) {
    offset += 1;
    rLength = 32;
  }

  const r = signature.subarray(offset, offset + rLength).toString("hex").padStart(64, "0");
  offset += rLength + 2;

  let sLength = signature[offset - 1];
  if (sLength === 33) {
    offset += 1;
    sLength = 32;
  }

  const s = signature.subarray(offset, offset + sLength).toString("hex").padStart(64, "0");
  return base64Url(Buffer.from(`${r}${s}`, "hex"));
}

function getVapidAuthorization(endpoint: string) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:contato@bmssistema.com";

  if (!publicKey || !privateKey) return null;

  const publicKeyBytes = decodeBase64Url(publicKey);
  const x = base64Url(publicKeyBytes.subarray(1, 33));
  const y = base64Url(publicKeyBytes.subarray(33, 65));
  const d = base64Url(decodeBase64Url(privateKey));
  const audience = new URL(endpoint).origin;
  const expiresAt = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = base64Url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ aud: audience, exp: expiresAt, sub: subject }));
  const unsignedToken = `${header}.${payload}`;
  const key = crypto.createPrivateKey({
    format: "jwk",
    key: { crv: "P-256", d, kty: "EC", x, y },
  });
  const signature = crypto.sign("sha256", Buffer.from(unsignedToken), key);
  const jwt = `${unsignedToken}.${derToJose(signature)}`;

  return `vapid t=${jwt}, k=${publicKey}`;
}

function getSupabaseServerClient() {
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

export async function POST(request: Request) {
  const body = (await request.json()) as ReminderRequest;

  if (!body.empresaId || !body.agendamentoIds?.length) {
    return NextResponse.json({ error: "Nenhum agendamento informado." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ configured: false, sent: 0 });
  }

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint")
    .eq("empresa_id", body.empresaId)
    .in("agendamento_id", body.agendamentoIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const subscriptions = ((data || []) as PushSubscriptionRow[]).filter((item) => item.endpoint);
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const authorization = getVapidAuthorization(subscription.endpoint);
      if (!authorization) return;

      const response = await fetch(subscription.endpoint, {
        headers: {
          Authorization: authorization,
          TTL: "86400",
          Urgency: "normal",
        },
        method: "POST",
      });

      if (response.ok || response.status === 201) {
        sent += 1;
      }
    }),
  );

  return NextResponse.json({ configured: Boolean(process.env.VAPID_PRIVATE_KEY), sent });
}
