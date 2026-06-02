import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMPRESA_ID_LEGADO = 1;

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase nao configurado." }, { status: 500 });
  }

  const empresaSlug = new URL(request.url).searchParams.get("empresa")?.trim();
  let query = supabase
    .from("empresas")
    .select("id,nome,slug,dias_atendimento,horarios_atendimento,licenca_expires_at")
    .eq("ativo", true);

  query = empresaSlug ? query.eq("slug", empresaSlug) : query.eq("id", EMPRESA_ID_LEGADO);

  const { data, error } = await query.maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (empresaSlug && !data) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  if (data?.licenca_expires_at && new Date(data.licenca_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Agenda temporariamente indisponivel." }, { status: 402 });
  }

  return NextResponse.json(
    {
      id: data?.id || EMPRESA_ID_LEGADO,
      nome: data?.nome || "Barbearia Teste",
      slug: data?.slug || null,
      dias_atendimento: data?.dias_atendimento || null,
      horarios_atendimento: data?.horarios_atendimento || null,
      updated_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
}
