import { NextResponse } from "next/server";
import { sendWhatsAppReminders } from "@/lib/evolutionApi";

type ReminderRequest = {
  agendamentoIds?: number[];
  empresaId?: number;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ReminderRequest;

  if (!body.empresaId || !body.agendamentoIds?.length) {
    return NextResponse.json({ error: "Nenhum agendamento informado." }, { status: 400 });
  }

  const result = await sendWhatsAppReminders(body.empresaId, body.agendamentoIds);

  if (result.error && result.configured) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
