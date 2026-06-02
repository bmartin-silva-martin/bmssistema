import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabaseClients() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) return null;

  return {
    auth: createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }),
    db: createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }),
  };
}

export async function GET(request: Request) {
  const clients = getSupabaseClients();

  if (!clients) {
    return NextResponse.json({ error: "Supabase nao configurado no servidor." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return NextResponse.json({ error: "Sessao nao informada." }, { status: 401 });
  }

  const { data: userData, error: userError } = await clients.auth.auth.getUser(token);

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Sessao invalida. Entre novamente no painel." }, { status: 401 });
  }

  const { data, error } = await clients.db
    .from("empresas")
    .select(
      "id,nome,plano,ativo,dias_atendimento,horarios_atendimento,nome_responsavel,slug,owner_user_id,licenca_install_id,licenca_expires_at,licenca_grace_days",
    )
    .eq("owner_user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      {
        error: "Nenhuma empresa encontrada para este login.",
        user: {
          email: userData.user.email,
          id: userData.user.id,
        },
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ empresa: data });
}
