import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMPRESA_ID_LEGADO = 1;

type ClienteUpdateRequest = {
  data_nascimento?: string | null;
  empresaId?: number;
  id?: number;
  nome?: string;
  telefone?: string | null;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function normalizarTelefoneBrasil(value = "") {
  let digits = value.replace(/\D/g, "");

  while (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }

  return digits;
}

function normalizarDataNascimento(value?: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  return value;
}

function getEmpresaId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : EMPRESA_ID_LEGADO;
}

export async function PATCH(request: Request) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase Service Role nao configurada na Vercel." }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as ClienteUpdateRequest | null;
  const empresaId = getEmpresaId(body?.empresaId);
  const id = Number(body?.id);
  const nome = body?.nome?.trim();
  const telefone = normalizarTelefoneBrasil(body?.telefone || "");

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Cliente invalido para atualizar." }, { status: 400 });
  }

  if (!nome) {
    return NextResponse.json({ error: "Informe o nome do cliente." }, { status: 400 });
  }

  if (telefone && (telefone.length < 12 || telefone.length > 13)) {
    return NextResponse.json({ error: "Informe um WhatsApp valido com DDD." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("clientes")
    .update({
      data_nascimento: normalizarDataNascimento(body?.data_nascimento),
      nome,
      telefone: telefone || null,
    })
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .select("id,nome,telefone,data_nascimento")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Cliente nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ cliente: data, updated_at: new Date().toISOString() });
}

export async function DELETE(request: Request) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase Service Role nao configurada na Vercel." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  const empresaId = getEmpresaId(searchParams.get("empresaId"));

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Cliente invalido." }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("clientes")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (count === 0) {
    return NextResponse.json({ error: "Cliente nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
