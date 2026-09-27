import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { enviarMensagemEvolution, evolutionConfig } from "@/lib/evolutionApi";
import { contarLembretesElegiveis, criarRepositorioSupabase, processarLembretesAutomaticos } from "@/lib/lembretesAutomaticos";
import { getSupabaseServerClient, isPushConfigured, sendPushReminders } from "@/lib/pushReminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  // Chamada externa (pg_cron + pg_net no Supabase): comparacao em tempo constante.
  const recebido = Buffer.from(request.headers.get("authorization") || "");
  const esperado = Buffer.from(`Bearer ${cronSecret}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase server-only nao configurado.", sent: 0 }, { status: 500 });
  }

  // WhatsApp e push sao independentes: canal sem configuracao fica de fora, o outro segue.
  const config = evolutionConfig();
  const pushConfigurado = isPushConfigured();

  // ?dryRun (qualquer valor) so conta: nenhuma escrita, nenhum envio. Na duvida, nunca cai no envio real.
  if (new URL(request.url).searchParams.has("dryRun")) {
    // Somente metodos de leitura chegam ao dry run.
    const { buscarAgendamentosComPush, buscarCandidatos, buscarMensagem } = criarRepositorioSupabase(supabase);
    try {
      const contagem = await contarLembretesElegiveis({
        agora: new Date(),
        repositorio: { buscarAgendamentosComPush, buscarCandidatos, buscarMensagem },
      });
      return NextResponse.json({ dryRun: true, ...contagem, pushConfigured: pushConfigurado, whatsappConfigured: Boolean(config) });
    } catch {
      return NextResponse.json({ dryRun: true, error: "Falha ao calcular lembretes." }, { status: 500 });
    }
  }

  try {
    const resumo = await processarLembretesAutomaticos({
      agora: new Date(),
      enviar: config ? (numero, texto) => enviarMensagemEvolution(config, numero, texto) : undefined,
      enviarPush: pushConfigurado
        ? async (empresaId, agendamentoId) => {
            const resultado = await sendPushReminders(empresaId, [agendamentoId]);
            if (resultado.sent > 0) return "enviado";
            if (resultado.configured && !resultado.error && resultado.subscriptions === 0) return "sem_inscricao";
            return "erro";
          }
        : undefined,
      repositorio: criarRepositorioSupabase(supabase),
    });

    if (resumo.whatsapp.interrompido === "configuracao") {
      console.error(`[lembretes] Evolution API recusou a configuracao (HTTP ${resumo.whatsapp.statusConfiguracao}). WhatsApp interrompido.`);
    }

    return NextResponse.json({ ...resumo, pushConfigured: pushConfigurado, whatsappConfigured: Boolean(config) });
  } catch {
    return NextResponse.json({ error: "Falha ao processar lembretes." }, { status: 500 });
  }
}
