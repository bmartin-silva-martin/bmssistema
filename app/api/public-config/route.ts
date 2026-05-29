import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMPRESA_ID = 1;

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

export async function GET() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase nao configurado." }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("empresas")
    .select("dias_atendimento,horarios_atendimento")
    .eq("id", EMPRESA_ID)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    dias_atendimento: data?.dias_atendimento || null,
    horarios_atendimento: data?.horarios_atendimento || null,
  });
}
