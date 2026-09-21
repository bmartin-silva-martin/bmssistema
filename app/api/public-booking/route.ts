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

type BookingBody = {
  empresa?: string | number;
  nome?: string;
  telefone?: string;
  dataNascimento?: string | null;
  aceitaLembrete?: boolean;
  servicoId?: number;
  profissionalId?: number | null;
  data?: string;
  hora?: string;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function normalizarTelefoneBrasil(value: string) {
  let digits = value.replace(/\D/g, "");

  while (digits.startsWith("0")) digits = digits.slice(1);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }

  return digits;
}

function normalizarHorario(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function isValidTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export async function POST(request: Request) {
  const supabase = getAdminClient();
  if (!supabase) return errorResponse("Agendamento indisponivel no momento.", 503);

  try {
    const body = (await request.json()) as BookingBody;
    const empresaRef = body.empresa;
    const nome = typeof body.nome === "string" ? body.nome.trim() : "";
    const telefone = typeof body.telefone === "string" ? normalizarTelefoneBrasil(body.telefone) : "";
    const servicoId = Number(body.servicoId);
    const profissionalId = body.profissionalId == null ? null : Number(body.profissionalId);
    const data = typeof body.data === "string" ? body.data : "";
    const hora = typeof body.hora === "string" ? body.hora : "";

    if (
      (typeof empresaRef !== "string" && typeof empresaRef !== "number") ||
      !nome ||
      nome.length > 160 ||
      !/^55\d{10,11}$/.test(telefone) ||
      !Number.isInteger(servicoId) ||
      servicoId <= 0 ||
      (profissionalId !== null && (!Number.isInteger(profissionalId) || profissionalId <= 0)) ||
      !isValidDate(data) ||
      !isValidTime(hora)
    ) {
      return errorResponse("Dados de agendamento invalidos.", 400);
    }

    const empresaQuery = supabase.from("empresas").select("id,dias_atendimento,horarios_atendimento,licenca_expires_at,ativo");
    const empresaLookup = typeof empresaRef === "number" || /^\d+$/.test(String(empresaRef).trim())
      ? empresaQuery.eq("id", Number(empresaRef))
      : empresaQuery.eq("slug", String(empresaRef).trim());
    const { data: empresa, error: empresaError } = await empresaLookup.eq("ativo", true).maybeSingle();

    if (empresaError) return errorResponse("Nao foi possivel validar a empresa.", 500);
    if (!empresa) return errorResponse("Empresa nao encontrada.", 404);
    if (empresa.licenca_expires_at && new Date(empresa.licenca_expires_at).getTime() < Date.now()) {
      return errorResponse("Agenda temporariamente indisponivel.", 402);
    }

    const { data: servico, error: servicoError } = await supabase
      .from("servicos")
      .select("id,empresa_id")
      .eq("id", servicoId)
      .eq("empresa_id", empresa.id)
      .maybeSingle();

    if (servicoError) return errorResponse("Nao foi possivel validar o servico.", 500);
    if (!servico) return errorResponse("Servico nao pertence a esta empresa.", 404);

    if (profissionalId !== null) {
      const { data: profissional, error: profissionalError } = await supabase
        .from("profissionais")
        .select("id,empresa_id,ativo")
        .eq("id", profissionalId)
        .eq("empresa_id", empresa.id)
        .eq("ativo", true)
        .maybeSingle();

      if (profissionalError) return errorResponse("Nao foi possivel validar o profissional.", 500);
      if (!profissional) return errorResponse("Profissional nao pertence a esta empresa.", 404);

      const { data: vinculos, error: vinculoError } = await supabase
        .from("profissional_servicos")
        .select("servico_id")
        .eq("profissional_id", profissionalId);

      if (vinculoError) return errorResponse("Nao foi possivel validar a agenda do profissional.", 500);
      if (vinculos.length > 0 && !vinculos.some((vinculo) => vinculo.servico_id === servicoId)) {
        return errorResponse("Profissional nao atende este servico.", 409);
      }
    }

    const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
    const diasAtendimento = Array.isArray(empresa.dias_atendimento) && empresa.dias_atendimento.length
      ? empresa.dias_atendimento
      : DIAS_ATENDIMENTO_PADRAO;
    const horariosAtendimento = Array.isArray(empresa.horarios_atendimento) && empresa.horarios_atendimento.length
      ? empresa.horarios_atendimento.map(normalizarHorario)
      : HORARIOS_PADRAO;

    if (!diasAtendimento.includes(diaSemana) || !horariosAtendimento.includes(hora)) {
      return errorResponse("Horario fora da configuracao de atendimento.", 409);
    }

    const horarioEscolhido = new Date(`${data}T${hora}:00-03:00`);
    if (horarioEscolhido.getTime() <= Date.now()) {
      return errorResponse("Esse horario ja passou.", 409);
    }

    let conflitoQuery = supabase
      .from("agendamentos")
      .select("id")
      .eq("empresa_id", empresa.id)
      .eq("data_agendamento", `${data} ${hora}:00`)
      .neq("status", "cancelado")
      .limit(1);
    if (profissionalId !== null) conflitoQuery = conflitoQuery.eq("profissional_id", profissionalId);

    const { data: conflito, error: conflitoError } = await conflitoQuery.maybeSingle();
    if (conflitoError) return errorResponse("Nao foi possivel verificar a disponibilidade.", 500);
    if (conflito) return errorResponse("Esse horario ja foi reservado.", 409);

    const { data: clienteExistente, error: clienteBuscaError } = await supabase
      .from("clientes")
      .select("id")
      .eq("empresa_id", empresa.id)
      .eq("telefone", telefone)
      .maybeSingle();

    if (clienteBuscaError) return errorResponse("Nao foi possivel localizar o cadastro.", 500);

    let clienteId = clienteExistente?.id;
    if (!clienteId) {
      const dataNascimento = typeof body.dataNascimento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dataNascimento)
        ? body.dataNascimento
        : null;
      const { data: novoCliente, error: clienteInsertError } = await supabase
        .from("clientes")
        .insert({
          aceita_lembrete: Boolean(body.aceitaLembrete),
          data_nascimento: dataNascimento,
          empresa_id: empresa.id,
          nome,
          telefone,
        })
        .select("id")
        .single();

      if (clienteInsertError || !novoCliente) return errorResponse("Nao foi possivel criar o cadastro.", 500);
      clienteId = novoCliente.id;
    }

    const { data: agendamento, error: agendamentoError } = await supabase
      .from("agendamentos")
      .insert({
        aceita_lembrete: Boolean(body.aceitaLembrete),
        cliente_id: clienteId,
        data_agendamento: `${data} ${hora}:00`,
        empresa_id: empresa.id,
        profissional_id: profissionalId,
        servico_id: servicoId,
        status: "confirmado",
      })
      .select("id")
      .single();

    if (agendamentoError || !agendamento) {
      return errorResponse("Nao foi possivel confirmar o agendamento.", 500);
    }

    return NextResponse.json({
      success: true,
      clienteId,
      agendamentoId: agendamento.id,
      data,
      hora,
      message: "Agendamento confirmado.",
    });
  } catch {
    return errorResponse("Requisicao de agendamento invalida.", 400);
  }
}
