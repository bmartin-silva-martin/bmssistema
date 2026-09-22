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

  // Um dono pode estar vinculado a mais de uma empresa (owner_user_id repetido).
  // Por isso buscamos todas em vez de usar .single()/.maybeSingle(), que quebram
  // com o erro PGRST116 ("multiple (or no) rows returned") nesse cenario.
  const { data, error } = await clients.db
    .from("empresas")
    .select(
      "id,nome,plano,ativo,dias_atendimento,horarios_atendimento,nome_responsavel,slug,owner_user_id,licenca_install_id,licenca_expires_at,licenca_grace_days,created_at",
    )
    .eq("owner_user_id", userData.user.id)
    .order("ativo", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
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

  // Empresa padrao: a ativa mais recente (ou, se nenhuma estiver ativa, a mais
  // recente no geral, pela ordenacao acima). Permite escolher outra via
  // ?empresaId=, desde que pertenca ao mesmo dono.
  const url = new URL(request.url);
  const empresaIdSolicitada = url.searchParams.get("empresaId");
  const empresaSelecionada =
    (empresaIdSolicitada && data.find((empresa) => String(empresa.id) === empresaIdSolicitada)) || data[0];

  return NextResponse.json({ empresa: empresaSelecionada, empresas: data });
}
