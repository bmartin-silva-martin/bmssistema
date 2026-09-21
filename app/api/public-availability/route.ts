import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const DIAS_ATENDIMENTO_PADRAO = [1, 2, 3, 4, 5, 6];
const HORARIOS_PADRAO = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "13:30",
  "13:45",
  "14:00",
  "14:15",
  "14:30",
  "14:45",
  "15:00",
  "16:00",
  "16:15",
  "16:30",
  "17:00",
];

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeHour(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export async function GET(request: Request) {
  const supabase = getAdminClient();
  if (!supabase) return responseError("Disponibilidade indisponivel no momento.", 503);

  const params = new URL(request.url).searchParams;
  const empresaRef = params.get("empresa")?.trim() || "";
  const data = params.get("data")?.trim() || "";
  const profissionalRaw = params.get("profissionalId");
  const servicoRaw = params.get("servicoId");
  const profissionalId = profissionalRaw ? Number(profissionalRaw) : null;
  const servicoId = servicoRaw ? Number(servicoRaw) : null;

  if (!empresaRef || !validDate(data)) return responseError("Parametros de disponibilidade invalidos.", 400);
  if (profissionalId !== null && (!Number.isInteger(profissionalId) || profissionalId <= 0)) {
    return responseError("Profissional invalido.", 400);
  }
  if (servicoId !== null && (!Number.isInteger(servicoId) || servicoId <= 0)) {
    return responseError("Servico invalido.", 400);
  }

  try {
    const empresaQuery = supabase
      .from("empresas")
      .select("id,dias_atendimento,horarios_atendimento,licenca_expires_at,ativo");
    const lookup = /^\d+$/.test(empresaRef)
      ? empresaQuery.eq("id", Number(empresaRef))
      : empresaQuery.eq("slug", empresaRef);
    const { data: empresa, error: empresaError } = await lookup.eq("ativo", true).maybeSingle();

    if (empresaError) return responseError("Nao foi possivel validar a empresa.", 500);
    if (!empresa) return responseError("Empresa nao encontrada.", 404);
    if (empresa.licenca_expires_at && new Date(empresa.licenca_expires_at).getTime() < Date.now()) {
      return responseError("Agenda temporariamente indisponivel.", 402);
    }

    if (servicoId !== null) {
      const { data: servico, error } = await supabase
        .from("servicos")
        .select("id")
        .eq("id", servicoId)
        .eq("empresa_id", empresa.id)
        .maybeSingle();
      if (error) return responseError("Nao foi possivel validar o servico.", 500);
      if (!servico) return responseError("Servico nao pertence a esta empresa.", 404);
    }

    if (profissionalId !== null) {
      const { data: profissional, error } = await supabase
        .from("profissionais")
        .select("id")
        .eq("id", profissionalId)
        .eq("empresa_id", empresa.id)
        .eq("ativo", true)
        .maybeSingle();
      if (error) return responseError("Nao foi possivel validar o profissional.", 500);
      if (!profissional) return responseError("Profissional nao pertence a esta empresa.", 404);
    }

    const inicio = `${data} 00:00:00`;
    const fim = `${data} 23:59:59`;
    let query = supabase
      .from("agendamentos")
      .select("data_agendamento")
      .eq("empresa_id", empresa.id)
      .neq("status", "cancelado")
      .gte("data_agendamento", inicio)
      .lte("data_agendamento", fim);
    if (profissionalId !== null) query = query.eq("profissional_id", profissionalId);

    const { data: agendamentos, error: agendamentosError } = await query;
    if (agendamentosError) return responseError("Nao foi possivel consultar a disponibilidade.", 500);

    const dias = Array.isArray(empresa.dias_atendimento) && empresa.dias_atendimento.length
      ? empresa.dias_atendimento
      : DIAS_ATENDIMENTO_PADRAO;
    const horarios = Array.isArray(empresa.horarios_atendimento) && empresa.horarios_atendimento.length
      ? empresa.horarios_atendimento.map(normalizeHour)
      : HORARIOS_PADRAO;
    const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
    const ocupados = (agendamentos || [])
      .map((agendamento) => agendamento.data_agendamento.slice(11, 16))
      .filter(Boolean);

    return NextResponse.json({
      data,
      diaAtendimento: dias.includes(diaSemana),
      horarios,
      ocupados,
    });
  } catch {
    return responseError("Requisicao de disponibilidade invalida.", 400);
  }
}
