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

// Busca a lista de profissionais ativos da empresa, com os servicos que cada um atende.
// Se as tabelas ainda nao existirem no banco (antes da migracao manual), devolve lista vazia
// em silencio, sem quebrar o carregamento da agenda publica.
async function buscarProfissionaisPublico(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  empresaId: number,
) {
  const { data: profissionaisData, error: profissionaisError } = await supabase
    .from("profissionais")
    .select("id,nome,foto_url")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .order("nome");

  if (profissionaisError || !profissionaisData || profissionaisData.length === 0) {
    return [] as { id: number; nome: string; foto_url: string | null; servico_ids: number[] }[];
  }

  const profissionalIds = profissionaisData.map((profissional) => profissional.id);
  const { data: vinculosData } = await supabase
    .from("profissional_servicos")
    .select("profissional_id,servico_id")
    .in("profissional_id", profissionalIds);

  return profissionaisData.map((profissional) => ({
    id: profissional.id,
    nome: profissional.nome,
    foto_url: profissional.foto_url ?? null,
    servico_ids: (vinculosData || [])
      .filter((vinculo) => vinculo.profissional_id === profissional.id)
      .map((vinculo) => vinculo.servico_id),
  }));
}

async function buscarServicosPublico(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  empresaId: number,
) {
  let { data, error } = await supabase
    .from("servicos")
    .select("id,nome,preco,duracao,foto_url")
    .eq("empresa_id", empresaId)
    .order("preco", { ascending: false });

  if (error?.message?.toLowerCase().includes("foto_url")) {
    const fallback = await supabase
      .from("servicos")
      .select("id,nome,preco,duracao")
      .eq("empresa_id", empresaId)
      .order("preco", { ascending: false });
    data = fallback.data?.map((servico) => ({ ...servico, foto_url: null })) || null;
    error = fallback.error;
  }

  if (error || !data) return [];

  return data.map((servico) => ({
    id: servico.id,
    nome: servico.nome,
    preco: servico.preco,
    duracao: servico.duracao,
    foto_url: servico.foto_url ?? null,
  }));
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

  const empresaId = data?.id || EMPRESA_ID_LEGADO;
  const [profissionais, servicos] = await Promise.all([
    buscarProfissionaisPublico(supabase, empresaId),
    buscarServicosPublico(supabase, empresaId),
  ]);

  // O dono pode forcar sempre/nunca mostrar a escolha de profissional em empresas.features.
  // Sem override, o passo aparece sozinho quando ha 2 ou mais profissionais ativos.
  const features = (data?.features as { mostrar_selecao_profissional?: boolean } | null) || null;
  const override = features?.mostrar_selecao_profissional;
  const mostrarSelecaoProfissional =
    override === false ? false : override === true ? profissionais.length > 0 : profissionais.length >= 2;

  return NextResponse.json(
    {
      id: empresaId,
      nome: data?.nome || "Barbearia Teste",
      slug: data?.slug || null,
      dias_atendimento: data?.dias_atendimento || null,
      horarios_atendimento: data?.horarios_atendimento || null,
      servicos,
      profissionais,
      mostrar_selecao_profissional: mostrarSelecaoProfissional,
      updated_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
}
