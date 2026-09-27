import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/serverAuth";

const MAX_AGENDAMENTOS = 100;

type PushSubscriptionRow = {
  endpoint: string;
};

type ReminderRequest = {
  agendamentoIds?: unknown;
  empresaId?: unknown;
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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ReminderRequest | null;
  const authorization = await authorizeRequest(request, body?.empresaId);
  if ("response" in authorization) return authorization.response;

  const { empresaId, supabase } = authorization;
  const agendamentoIds = Array.isArray(body?.agendamentoIds)
    ? [...new Set(body.agendamentoIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  if (agendamentoIds.length === 0) {
    return NextResponse.json({ error: "Nenhum agendamento informado." }, { status: 400 });
  }

  if (agendamentoIds.length > MAX_AGENDAMENTOS) {
    return NextResponse.json({ error: "Agendamentos demais em uma unica solicitacao." }, { status: 400 });
  }

  // push_subscriptions.empresa_id vem do navegador do cliente; a posse do agendamento e validada aqui.
  const { data: agendamentos, error: agendamentosError } = await supabase
    .from("agendamentos")
    .select("id")
    .eq("empresa_id", empresaId)
    .in("id", agendamentoIds);

  if (agendamentosError) {
    return NextResponse.json({ error: "Falha ao consultar agendamentos." }, { status: 500 });
  }

  const idsDaEmpresa = ((agendamentos || []) as { id: number }[]).map((agendamento) => agendamento.id);
  if (idsDaEmpresa.length === 0) {
    return NextResponse.json({ configured: Boolean(process.env.VAPID_PRIVATE_KEY), sent: 0 });
  }

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint")
    .eq("empresa_id", empresaId)
    .in("agendamento_id", idsDaEmpresa);

  if (error) {
    return NextResponse.json({ error: "Falha ao consultar inscricoes push." }, { status: 500 });
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
