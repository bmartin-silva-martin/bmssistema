import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA23pfdemicjs+ed9X8Ur1
HU2pgbLExgTtyAJzWMtzgx2FbzjKQ9Bli3xoeqSfFAc2uF9+pf01tPp/z3vPaDh6
y1x0uQ9DIIKdzWwGywHZifZu1MB7RkP9hzHqrP9uLXquZVmrWBl/hORyoozZi9DV
t8RcqKM8s+QoD11NDJe+U3K3INBo+h/kTsHwpxQUcp7Xv0SwAULCSeYK4UlPkBpb
7idYRM03yEYwCyxifdYVmFiUmIAxyuMZTwf39MkaySkQl3Gr7PsuIsciQ7vqkeat
8QPUf9oSxl1e810Mu4MRHv1xeUZMJZ+oHcLmBQvgdswhA+qAhFHNZk82Zlg5+3J+
YQIDAQAB
-----END PUBLIC KEY-----`;

type LicensePayload = {
  daysToAdd?: number;
  installId?: string;
  issuedAt?: number;
  nonce?: string;
};

function base64urlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

function getSupabaseAdmin() {
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

function validarToken(token: string): LicensePayload {
  const [payloadPart, signaturePart] = token.trim().split(".");

  if (!payloadPart || !signaturePart) {
    throw new Error("Chave de licenca invalida.");
  }

  const payloadBytes = base64urlDecode(payloadPart);
  const signature = base64urlDecode(signaturePart);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(payloadBytes);
  verifier.end();

  if (!verifier.verify(PUBLIC_KEY, signature)) {
    throw new Error("Assinatura da licenca invalida.");
  }

  const payload = JSON.parse(payloadBytes.toString("utf8")) as LicensePayload;

  if (!payload.installId || !payload.nonce || !payload.issuedAt) {
    throw new Error("Licenca incompleta.");
  }

  if (!Number.isFinite(payload.daysToAdd) || Number(payload.daysToAdd) <= 0) {
    throw new Error("Prazo da licenca invalido.");
  }

  const idadeMs = Date.now() - Number(payload.issuedAt);
  const seteDiasMs = 7 * 24 * 60 * 60 * 1000;

  if (idadeMs < 0 || idadeMs > seteDiasMs) {
    throw new Error("Esta chave expirou. Gere uma nova chave.");
  }

  return payload;
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase nao configurado no servidor." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const empresaId = Number(body?.empresaId);
  const token = String(body?.token || "");

  if (!empresaId || !token) {
    return NextResponse.json({ error: "Informe a empresa e a chave de licenca." }, { status: 400 });
  }

  let payload: LicensePayload;

  try {
    payload = validarToken(token);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Licenca invalida." }, { status: 400 });
  }

  const { data: empresa, error: empresaError } = await supabase
    .from("empresas")
    .select("id,licenca_install_id,licenca_expires_at,licenca_grace_days,licenca_last_nonce")
    .eq("id", empresaId)
    .single();

  if (empresaError || !empresa) {
    return NextResponse.json({ error: empresaError?.message || "Empresa nao encontrada." }, { status: 404 });
  }

  if (empresa.licenca_install_id !== payload.installId) {
    return NextResponse.json({ error: "Esta chave nao pertence a esta empresa." }, { status: 400 });
  }

  if (empresa.licenca_last_nonce === payload.nonce) {
    return NextResponse.json({ error: "Esta chave ja foi usada." }, { status: 400 });
  }

  const graceDays = Number(empresa.licenca_grace_days ?? 3);
  const currentExpiration = empresa.licenca_expires_at ? new Date(empresa.licenca_expires_at) : new Date();
  const baseDate = currentExpiration.getTime() > Date.now() ? currentExpiration : new Date();
  const totalDays = Number(payload.daysToAdd) + graceDays;
  const nextExpiration = new Date(baseDate);
  nextExpiration.setDate(nextExpiration.getDate() + totalDays);

  const { data, error } = await supabase
    .from("empresas")
    .update({
      ativo: true,
      licenca_expires_at: nextExpiration.toISOString(),
      licenca_last_nonce: payload.nonce,
    })
    .eq("id", empresaId)
    .select("id,licenca_install_id,licenca_expires_at,licenca_grace_days")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ empresa: data });
}
