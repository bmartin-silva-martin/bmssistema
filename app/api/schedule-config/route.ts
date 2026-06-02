import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMPRESA_ID_LEGADO = 1;
const DIAS_VALIDOS = new Set([0, 1, 2, 3, 4, 5, 6]);

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

function normalizarHorario(horario: unknown) {
  if (typeof horario !== "string") return null;

  const partes = horario.split(":");
  if (partes.length < 2) return null;

  const horas = Number(partes[0]);
  const minutos = Number(partes[1]);

  if (!Number.isInteger(horas) || !Number.isInteger(minutos)) return null;
  if (horas < 0 || horas > 23 || minutos < 0 || minutos > 59) return null;

  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

function normalizarDias(dias: unknown) {
  if (!Array.isArray(dias)) return [];

  return Array.from(new Set(dias.map(Number).filter((dia) => DIAS_VALIDOS.has(dia)))).sort((a, b) => a - b);
}

function normalizarHorarios(horarios: unknown) {
  if (!Array.isArray(horarios)) return [];

  return Array.from(
    new Set(
      horarios
        .map(normalizarHorario)
        .filter((horario): horario is string => Boolean(horario)),
    ),
  ).sort();
}

function getEmpresaId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : EMPRESA_ID_LEGADO;
}

async function buscarConfiguracao(empresaId: number) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return { data: null, error: "Supabase Service Role nao configurada na Vercel." };
  }

  const { data, error } = await supabase
    .from("empresas")
    .select("dias_atendimento,horarios_atendimento")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };

  return { data, error: null };
}

export async function GET(request: Request) {
  const empresaId = getEmpresaId(new URL(request.url).searchParams.get("empresaId"));
  const { data, error } = await buscarConfiguracao(empresaId);

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json(
    {
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

export async function PUT(request: Request) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase Service Role nao configurada na Vercel." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const empresaId = getEmpresaId(body?.empresaId);
  const diasAtendimento = normalizarDias(body?.dias_atendimento);
  const horariosAtendimento = normalizarHorarios(body?.horarios_atendimento);

  if (diasAtendimento.length === 0) {
    return NextResponse.json({ error: "Selecione pelo menos um dia de atendimento." }, { status: 400 });
  }

  if (horariosAtendimento.length === 0) {
    return NextResponse.json({ error: "Adicione pelo menos um horario de atendimento." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("empresas")
    .update({
      dias_atendimento: diasAtendimento,
      horarios_atendimento: horariosAtendimento,
    })
    .eq("id", empresaId)
    .select("dias_atendimento,horarios_atendimento")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Empresa nao encontrada para salvar os horarios." }, { status: 404 });
  }

  return NextResponse.json({
    dias_atendimento: data.dias_atendimento,
    horarios_atendimento: data.horarios_atendimento,
    updated_at: new Date().toISOString(),
  });
}
