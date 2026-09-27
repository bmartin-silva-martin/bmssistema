import { NextResponse } from "next/server";
import { sendWhatsAppReminders } from "@/lib/evolutionApi";
import { authorizeRequest } from "@/lib/serverAuth";

const MAX_AGENDAMENTOS = 100;

type ReminderRequest = {
  agendamentoIds?: unknown;
  empresaId?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ReminderRequest | null;
  const authorization = await authorizeRequest(request, body?.empresaId);
  if ("response" in authorization) return authorization.response;

  const agendamentoIds = Array.isArray(body?.agendamentoIds)
    ? [...new Set(body.agendamentoIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  if (agendamentoIds.length === 0) {
    return NextResponse.json({ error: "Nenhum agendamento informado." }, { status: 400 });
  }

  if (agendamentoIds.length > MAX_AGENDAMENTOS) {
    return NextResponse.json({ error: "Agendamentos demais em uma unica solicitacao." }, { status: 400 });
  }

  // empresaId vem da sessao autorizada; sendWhatsAppReminders filtra agendamentos por empresa_id.
  const result = await sendWhatsAppReminders(authorization.empresaId, agendamentoIds);

  if (result.error && result.configured) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
