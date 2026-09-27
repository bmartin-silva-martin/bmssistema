import { NextResponse } from "next/server";
import { enviarMensagemEvolution, evolutionConfig } from "@/lib/evolutionApi";
import { criarRepositorioSupabase, processarLembretesAutomaticos } from "@/lib/lembretesAutomaticos";
import { getSupabaseServerClient, sendPushReminders } from "@/lib/pushReminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase server-only nao configurado.", sent: 0 }, { status: 500 });
  }

  const config = evolutionConfig();
  if (!config) {
    return NextResponse.json({ whatsappConfigured: false });
  }

  try {
    const resumo = await processarLembretesAutomaticos({
      agora: new Date(),
      enviar: (numero, texto) => enviarMensagemEvolution(config, numero, texto),
      enviarPush: (empresaId, agendamentoIds) => sendPushReminders(empresaId, agendamentoIds),
      repositorio: criarRepositorioSupabase(supabase),
    });

    if (resumo.interrompido === "configuracao") {
      console.error(`[lembretes] Evolution API recusou a configuracao (HTTP ${resumo.statusConfiguracao}). Execucao interrompida.`);
    }

    return NextResponse.json({ ...resumo, whatsappConfigured: true });
  } catch {
    return NextResponse.json({ error: "Falha ao processar lembretes." }, { status: 500 });
  }
}
