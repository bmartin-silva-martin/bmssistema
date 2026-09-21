import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  while (digits.startsWith("0")) digits = digits.slice(1);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) digits = `55${digits}`;
  return digits;
}

async function resolveCompany(supabase: ReturnType<typeof getAdminClient>, reference: string) {
  if (!supabase) return { company: null, error: "unavailable" as const };
  const query = supabase.from("empresas").select("id,ativo");
  const lookup = /^\d+$/.test(reference) ? query.eq("id", Number(reference)) : query.eq("slug", reference);
  const result = await lookup.eq("ativo", true).maybeSingle();
  return { company: result.data, error: result.error };
}

function isHistoryScope(value: string) {
  return value === "history";
}

export async function GET(request: Request) {
  const supabase = getAdminClient();
  if (!supabase) return responseError("Consulta indisponivel no momento.", 503);

  const params = new URL(request.url).searchParams;
  const empresa = params.get("empresa")?.trim() || "";
  const telefone = normalizePhone(params.get("telefone") || "");
  const scope = params.get("scope") || "future";
  if (!empresa || !/^55\d{10,11}$/.test(telefone) || !["future", "history"].includes(scope)) {
    return responseError("Parametros de consulta invalidos.", 400);
  }

  try {
    const resolved = await resolveCompany(supabase, empresa);
    if (resolved.error) return responseError("Nao foi possivel validar a empresa.", 500);
    if (!resolved.company) return responseError("Empresa nao encontrada.", 404);

    const { data: clientes, error: clienteError } = await supabase
      .from("clientes")
      .select("id")
      .eq("empresa_id", resolved.company.id)
      .eq("telefone", telefone);
    if (clienteError) return responseError("Nao foi possivel consultar os agendamentos.", 500);

    const clienteIds = (clientes || []).map((cliente) => cliente.id);
    if (clienteIds.length === 0) return NextResponse.json({ appointments: [] });

    const hoje = new Date();
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() - 365);
    let query = supabase
      .from("agendamentos")
      .select("id,data_agendamento,status,servicos(nome)")
      .eq("empresa_id", resolved.company.id)
      .in("cliente_id", clienteIds)
      .neq("status", "cancelado");

    if (isHistoryScope(scope)) {
      query = query.lt("data_agendamento", hoje.toISOString().slice(0, 10)).gte("data_agendamento", limite.toISOString().slice(0, 10));
    } else {
      query = query.gte("data_agendamento", hoje.toISOString().slice(0, 10)).neq("status", "finalizado");
    }

    const { data: agendamentos, error: agendamentoError } = await query.order("data_agendamento", { ascending: !isHistoryScope(scope) });
    if (agendamentoError) return responseError("Nao foi possivel consultar os agendamentos.", 500);

    return NextResponse.json({
      appointments: (agendamentos || []).map((agendamento) => {
        const servico = Array.isArray(agendamento.servicos) ? agendamento.servicos[0] : agendamento.servicos;
        return {
          id: agendamento.id,
          data_agendamento: agendamento.data_agendamento,
          status: agendamento.status,
          servico: servico?.nome || "Servico",
        };
      }),
    });
  } catch {
    return responseError("Requisicao de consulta invalida.", 400);
  }
}

export async function PATCH(request: Request) {
  const supabase = getAdminClient();
  if (!supabase) return responseError("Cancelamento indisponivel no momento.", 503);

  try {
    const body = (await request.json()) as { empresa?: string | number; telefone?: string; agendamentoId?: number };
    const empresa = body.empresa == null ? "" : String(body.empresa).trim();
    const telefone = typeof body.telefone === "string" ? normalizePhone(body.telefone) : "";
    const agendamentoId = Number(body.agendamentoId);
    if (!empresa || !/^55\d{10,11}$/.test(telefone) || !Number.isInteger(agendamentoId) || agendamentoId <= 0) {
      return responseError("Dados de cancelamento invalidos.", 400);
    }

    const resolved = await resolveCompany(supabase, empresa);
    if (resolved.error) return responseError("Nao foi possivel validar a empresa.", 500);
    if (!resolved.company) return responseError("Empresa nao encontrada.", 404);

    const { data: clientes, error: clienteError } = await supabase
      .from("clientes")
      .select("id")
      .eq("empresa_id", resolved.company.id)
      .eq("telefone", telefone);
    if (clienteError) return responseError("Nao foi possivel validar o cliente.", 500);

    const clienteIds = (clientes || []).map((cliente) => cliente.id);
    if (clienteIds.length === 0) return responseError("Agendamento nao encontrado.", 404);

    const { data: atualizado, error: updateError } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", agendamentoId)
      .eq("empresa_id", resolved.company.id)
      .in("cliente_id", clienteIds)
      .eq("status", "confirmado")
      .select("id,status")
      .maybeSingle();

    if (updateError) return responseError("Nao foi possivel cancelar o agendamento.", 500);
    if (!atualizado) return responseError("Agendamento nao encontrado ou nao pode ser cancelado.", 404);

    return NextResponse.json({ success: true, status: atualizado.status, message: "Agendamento cancelado com sucesso." });
  } catch {
    return responseError("Requisicao de cancelamento invalida.", 400);
  }
}
