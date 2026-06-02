import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMPRESA_ID_LEGADO = 1;
const MISSING_COLUMN_HINT =
  'Rode no Supabase: alter table empresas add column if not exists nome_responsavel text;';

type CompanyProfileRequest = {
  empresaId?: number;
  nome_responsavel?: string | null;
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

function isMissingResponsibleNameColumn(errorMessage = "") {
  return errorMessage.toLowerCase().includes("nome_responsavel");
}

function getEmpresaId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : EMPRESA_ID_LEGADO;
}

export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  const empresaId = getEmpresaId(new URL(request.url).searchParams.get("empresaId"));

  if (!supabase) {
    return NextResponse.json({ error: "Supabase Service Role nao configurada na Vercel." }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("empresas")
    .select("id,nome,slug,nome_responsavel")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) {
    if (isMissingResponsibleNameColumn(error.message)) {
      return NextResponse.json({ empresa: { id: empresaId, nome_responsavel: null }, needs_schema: true });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ empresa: data });
}

export async function PATCH(request: Request) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase Service Role nao configurada na Vercel." }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as CompanyProfileRequest | null;
  const empresaId = getEmpresaId(body?.empresaId);
  const nomeResponsavel = body?.nome_responsavel?.trim() || null;

  const { data, error } = await supabase
    .from("empresas")
    .update({ nome_responsavel: nomeResponsavel })
    .eq("id", empresaId)
    .select("id,nome,slug,nome_responsavel")
    .maybeSingle();

  if (error) {
    if (isMissingResponsibleNameColumn(error.message)) {
      return NextResponse.json({ error: MISSING_COLUMN_HINT }, { status: 400 });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  return NextResponse.json({ empresa: data, updated_at: new Date().toISOString() });
}
