// Simula o runtime da Vercel (UTC). As regras nao podem depender do fuso do processo.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import http from "node:http";
import { registerHooks } from "node:module";
import { after, before, describe, it } from "node:test";

const raiz = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, raiz).href, context);
    return nextResolve(specifier, context);
  },
});

const { horarioLocalDoInstante, lerHorarioLocal, lerInstante, minutosAteHorarioLocal } = await import("../lib/horarioLocal.ts");
const { classificarResultadoEnvio, montarMensagemLembrete, montarMensagemManual, telefoneWhatsAppValido, tipoLembreteElegivel, tipoLembretePorHorario } =
  await import(
  "../lib/lembretesWhatsApp.ts"
);
const { processarLembretesAutomaticos } = await import("../lib/lembretesAutomaticos.ts");
const { enviarMensagemEvolution } = await import("../lib/evolutionApi.ts");

// 2026-09-28 08:00 em America/Sao_Paulo.
const AGORA_08H = new Date("2026-09-28T11:00:00Z");
const CRIADO_ONTEM = "2026-09-27T12:00:00+00:00";

function agendamento(campos = {}) {
  return { aceita_lembrete: true, created_at: CRIADO_ONTEM, data_agendamento: "2026-09-28T15:00:00+00:00", status: "confirmado", ...campos };
}

describe("fuso America/Sao_Paulo", () => {
  it("calcula minutos ate 09:00, 10:00, 12:00, 15:00 e 17:00 a partir das 08:00 locais", () => {
    const esperado = { "09:00": 60, "10:00": 120, "12:00": 240, "15:00": 420, "17:00": 540 };

    for (const [hora, minutos] of Object.entries(esperado)) {
      for (const formato of [`2026-09-28 ${hora}:00`, `2026-09-28T${hora}:00+00:00`, `2026-09-28T${hora}:00`]) {
        assert.equal(minutosAteHorarioLocal(lerHorarioLocal(formato), AGORA_08H), minutos, formato);
      }
    }
  });

  it("new Date() direto seria 3h errado; o helper nao e", () => {
    const valor = "2026-09-28T15:00:00+00:00";
    assert.equal((new Date(valor).getTime() - AGORA_08H.getTime()) / 60000, 240);
    assert.equal(minutosAteHorarioLocal(lerHorarioLocal(valor), AGORA_08H), 420);
  });

  it("le data e hora local do instante, inclusive perto da meia-noite", () => {
    assert.deepEqual(horarioLocalDoInstante(AGORA_08H), { data: "2026-09-28", hora: "08:00", minutosDoDia: 480 });
    assert.equal(horarioLocalDoInstante(new Date("2026-09-28T02:30:00Z")).data, "2026-09-27");
  });

  it("rejeita horario invalido", () => {
    assert.equal(lerHorarioLocal("2026-02-30 10:00:00"), null);
    assert.equal(lerHorarioLocal("2026-09-28 25:00:00"), null);
    assert.equal(lerHorarioLocal(null), null);
    assert.equal(lerHorarioLocal("lixo"), null);
  });

  it("created_at e lido como instante real", () => {
    assert.equal(lerInstante("2026-09-28T02:00:00+00:00").toISOString(), "2026-09-28T02:00:00.000Z");
    assert.equal(lerInstante("2026-09-28 02:00:00").toISOString(), "2026-09-28T02:00:00.000Z");
    assert.equal(lerInstante("2026-09-28T02:00:00.123456+00:00").toISOString(), "2026-09-28T02:00:00.123Z");
    assert.equal(lerInstante("2026-09-27T23:00:00-03").toISOString(), "2026-09-28T02:00:00.000Z");
    assert.equal(lerInstante(""), null);
    assert.equal(lerInstante("lixo"), null);
  });
});

describe("elegibilidade", () => {
  it("reminder_day elegivel as 08:00 para agendamento criado antes de hoje", () => {
    assert.equal(tipoLembreteElegivel(agendamento(), AGORA_08H), "reminder_day");
  });

  it("agendamento criado hoje nao recebe reminder_day", () => {
    assert.equal(tipoLembreteElegivel(agendamento({ created_at: "2026-09-28T10:30:00+00:00" }), AGORA_08H), null);
  });

  it("created_at de ontem a noite (UTC ja e hoje) ainda conta como ontem", () => {
    assert.equal(tipoLembreteElegivel(agendamento({ created_at: "2026-09-28T02:00:00+00:00" }), AGORA_08H), "reminder_day");
  });

  it("sem created_at confiavel nao envia reminder_day", () => {
    assert.equal(tipoLembreteElegivel(agendamento({ created_at: null }), AGORA_08H), null);
    assert.equal(tipoLembreteElegivel(agendamento({ created_at: "lixo" }), AGORA_08H), null);
  });

  it("antes das 08:00 locais nao envia reminder_day", () => {
    assert.equal(tipoLembreteElegivel(agendamento(), new Date("2026-09-28T10:45:00Z")), null);
  });

  it("reminder_2h elegivel entre 30 e 130 minutos, inclusive", () => {
    for (const hora of ["08:30", "09:00", "10:00", "10:10"]) {
      assert.equal(tipoLembreteElegivel(agendamento({ data_agendamento: `2026-09-28 ${hora}:00` }), AGORA_08H), "reminder_2h", hora);
    }
  });

  it("fora da janela nao envia", () => {
    assert.equal(tipoLembreteElegivel(agendamento({ data_agendamento: "2026-09-28 08:29:00" }), AGORA_08H), null);
    assert.equal(tipoLembreteElegivel(agendamento({ data_agendamento: "2026-09-28 07:00:00" }), AGORA_08H), null);
    assert.equal(tipoLembreteElegivel(agendamento({ data_agendamento: "2026-09-29 15:00:00" }), AGORA_08H), null);
    // 131 min: fora do 2h e perto demais dele para o do dia (precisa de 220 min = 130 + 90).
    assert.equal(tipoLembreteElegivel(agendamento({ data_agendamento: "2026-09-28 10:11:00" }), AGORA_08H), null);
    assert.equal(tipoLembreteElegivel(agendamento({ data_agendamento: "2026-09-28 11:40:00" }), AGORA_08H), "reminder_day");
  });

  it("regra de horario do push nao depende de aceita_lembrete", () => {
    for (const aceita of [false, null, undefined, true]) {
      assert.equal(tipoLembretePorHorario(agendamento({ aceita_lembrete: aceita }), AGORA_08H), "reminder_day", String(aceita));
      assert.equal(tipoLembretePorHorario(agendamento({ aceita_lembrete: aceita, data_agendamento: "2026-09-28 10:00:00" }), AGORA_08H), "reminder_2h");
    }
  });

  it("aceita_lembrete precisa ser true", () => {
    for (const aceita of [false, null, undefined]) {
      assert.equal(tipoLembreteElegivel(agendamento({ aceita_lembrete: aceita }), AGORA_08H), null, String(aceita));
      assert.equal(tipoLembreteElegivel(agendamento({ aceita_lembrete: aceita, data_agendamento: "2026-09-28 10:00:00" }), AGORA_08H), null);
    }
  });

  it("10:15 nao recebe lembrete do dia as 08:00, somente o de 2h", () => {
    const item = agendamento({ data_agendamento: "2026-09-28 10:15:00" });
    assert.equal(tipoLembreteElegivel(item, AGORA_08H), null);
    assert.equal(tipoLembreteElegivel(item, new Date("2026-09-28T11:05:00Z")), "reminder_2h");
  });

  it("15:00 recebe o do dia as 08:00 e o de 2h por volta das 13:00", () => {
    const item = agendamento({ data_agendamento: "2026-09-28 15:00:00" });
    assert.equal(tipoLembreteElegivel(item, AGORA_08H), "reminder_day");
    assert.equal(tipoLembreteElegivel(item, new Date("2026-09-28T15:45:00Z")), null);
    assert.equal(tipoLembreteElegivel(item, new Date("2026-09-28T16:00:00Z")), "reminder_2h");
  });

  it("lembrete manual recente bloqueia os automaticos; o do dia fica bloqueado no dia inteiro", () => {
    const manual08h = { ultimo_manual_em: "2026-09-28T11:00:00.000Z" };
    assert.equal(tipoLembreteElegivel(agendamento(manual08h), new Date("2026-09-28T11:15:00Z")), null);
    assert.equal(tipoLembreteElegivel(agendamento(manual08h), new Date("2026-09-28T13:00:00Z")), null);
    // 2h: bloqueado ate 90 min depois do manual.
    const as10h = agendamento({ ...manual08h, data_agendamento: "2026-09-28 10:00:00" });
    assert.equal(tipoLembreteElegivel(as10h, new Date("2026-09-28T11:05:00Z")), null);
    assert.equal(tipoLembreteElegivel({ ...as10h, data_agendamento: "2026-09-28 11:00:00" }, new Date("2026-09-28T12:30:00Z")), "reminder_2h");
    // Manual de ontem nao bloqueia o do dia de hoje.
    assert.equal(tipoLembreteElegivel(agendamento({ ultimo_manual_em: CRIADO_ONTEM }), AGORA_08H), "reminder_day");
  });

  it("reminder_day nao cobre o que o reminder_2h cobre (<= 130 min)", () => {
    const criadoHoje = { created_at: "2026-09-28T10:30:00+00:00" };
    assert.equal(tipoLembreteElegivel(agendamento({ ...criadoHoje, data_agendamento: "2026-09-28 10:00:00" }), AGORA_08H), "reminder_2h");
  });

  it("cancelado e finalizado nunca recebem", () => {
    for (const status of ["cancelado", "finalizado", "concluido", null]) {
      assert.equal(tipoLembreteElegivel(agendamento({ status }), AGORA_08H), null, String(status));
      assert.equal(tipoLembreteElegivel(agendamento({ data_agendamento: "2026-09-28 10:00:00", status }), AGORA_08H), null);
    }
  });
});

describe("mensagens", () => {
  const base = { cliente: "Bruno", empresa: "Barbearia X", hora: "15:00", profissional: "João", servico: "Corte" };

  it("reminder_day com empresa, servico e profissional", () => {
    assert.equal(
      montarMensagemLembrete("reminder_day", base),
      "Olá, Bruno! A Barbearia X lembra que você tem um horário hoje às 15:00 para Corte, com João. Estamos te esperando.",
    );
  });

  it("reminder_day sem profissional e sem servico", () => {
    assert.equal(
      montarMensagemLembrete("reminder_day", { ...base, profissional: null }),
      "Olá, Bruno! A Barbearia X lembra que você tem um horário hoje às 15:00 para Corte. Estamos te esperando.",
    );
    assert.equal(
      montarMensagemLembrete("reminder_day", { ...base, profissional: undefined, servico: "  " }),
      "Olá, Bruno! A Barbearia X lembra que você tem um horário hoje às 15:00. Estamos te esperando.",
    );
  });

  it("reminder_2h nas tres variacoes", () => {
    assert.equal(
      montarMensagemLembrete("reminder_2h", base),
      "Olá, Bruno! A Barbearia X lembra que seu horário é hoje às 15:00 para Corte, com João. Falta pouco para o seu atendimento. Até já.",
    );
    assert.equal(
      montarMensagemLembrete("reminder_2h", { ...base, profissional: null }),
      "Olá, Bruno! A Barbearia X lembra que seu horário é hoje às 15:00 para Corte. Falta pouco para o seu atendimento. Até já.",
    );
    assert.equal(
      montarMensagemLembrete("reminder_2h", { ...base, profissional: null, servico: null }),
      "Olá, Bruno! A Barbearia X lembra que seu horário é hoje às 15:00. Falta pouco para o seu atendimento. Até já.",
    );
  });

  it("sem nome de empresa ou cliente continua natural", () => {
    assert.equal(
      montarMensagemLembrete("reminder_day", { ...base, empresa: null, profissional: null }),
      "Olá, Bruno! Passando para lembrar que você tem um horário agendado hoje às 15:00 para Corte. Estamos te esperando.",
    );
    assert.equal(
      montarMensagemLembrete("reminder_2h", { hora: "15:00" }),
      "Olá! Seu horário é hoje às 15:00. Falta pouco para o seu atendimento. Até já.",
    );
  });

  it("mensagem manual usa horario local mesmo com o servidor em UTC", () => {
    assert.equal(
      montarMensagemManual({ data_agendamento: "2026-09-28T15:00:00+00:00" }, base, AGORA_08H),
      "Olá, Bruno! A Barbearia X lembra que você tem um horário hoje às 15:00 para Corte, com João. Estamos te esperando.",
    );
    assert.equal(
      montarMensagemManual({ data_agendamento: "2026-09-29 09:30:00" }, { cliente: null, empresa: null }, AGORA_08H),
      "Olá! Passando para lembrar que você tem um horário agendado amanhã às 09:30. Estamos te esperando.",
    );
    assert.equal(
      montarMensagemManual({ data_agendamento: "2026-10-05 09:30:00" }, { empresa: "Barbearia X" }, AGORA_08H),
      "Olá! A Barbearia X lembra que você tem um horário no dia 05/10 às 09:30. Estamos te esperando.",
    );
    // 23:30 locais do dia 27 ja e dia 28 em UTC: "amanhã" continua certo.
    assert.match(montarMensagemManual({ data_agendamento: "2026-09-28 10:00:00" }, {}, new Date("2026-09-28T02:30:00Z")), /amanhã às 10:00/);
    assert.equal(montarMensagemManual({ data_agendamento: "lixo" }, {}, AGORA_08H), null);
  });

  it("nunca gera null, undefined ou trecho vazio", () => {
    for (const tipo of ["reminder_day", "reminder_2h", "manual_reminder"]) {
      for (const campos of [{}, { cliente: null, empresa: null, profissional: null, servico: null }, { profissional: "Ana" }]) {
        const texto = montarMensagemLembrete(tipo, { hora: "09:00", ...campos });
        assert.doesNotMatch(texto, /null|undefined|para \.|com \.|  /);
      }
    }
  });
});

describe("telefone e classificacao de falhas", () => {
  it("valida ^55\\d{10,11}$ depois de normalizar", () => {
    assert.equal(telefoneWhatsAppValido("(11) 99999-0000"), "5511999990000");
    assert.equal(telefoneWhatsAppValido("1133334444"), "551133334444");
    assert.equal(telefoneWhatsAppValido("5511999990000"), "5511999990000");
    assert.equal(telefoneWhatsAppValido("011999990000"), "5511999990000");
    for (const invalido of ["", null, undefined, "12345", "1199999000011", "abc"]) {
      assert.equal(telefoneWhatsAppValido(invalido), null, String(invalido));
    }
  });

  it("classifica respostas da Evolution", () => {
    assert.equal(classificarResultadoEnvio({ tipo: "ok" }), "enviado");
    assert.equal(classificarResultadoEnvio({ tipo: "timeout" }), "incerto");
    assert.equal(classificarResultadoEnvio({ tipo: "rede" }), "erro");
    assert.equal(classificarResultadoEnvio({ status: 400, tipo: "http" }), "falha_definitiva");
    for (const status of [401, 403, 404]) assert.equal(classificarResultadoEnvio({ status, tipo: "http" }), "configuracao");
    for (const status of [408, 429, 500, 502, 503]) assert.equal(classificarResultadoEnvio({ status, tipo: "http" }), "erro");
  });
});

describe("cliente Evolution (servidor local, sem WhatsApp real)", () => {
  let servidor;
  let config;
  const pendentes = [];
  const recebidos = [];

  before(async () => {
    servidor = http.createServer(async (req, res) => {
      let corpo = "";
      for await (const parte of req) corpo += parte;
      recebidos.push({ apikey: req.headers.apikey, corpo: JSON.parse(corpo), url: req.url });
      const status = Number(JSON.parse(corpo).number.slice(-3));
      if (status === 999) return pendentes.push(res);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    config = { apiKey: "chave-teste", baseUrl: `http://127.0.0.1:${servidor.address().port}`, instance: "inst" };
  });

  after(() => {
    for (const res of pendentes) res.destroy();
    servidor.close();
  });

  it("usa endpoint, header e payload v2 atuais", async () => {
    assert.deepEqual(await enviarMensagemEvolution(config, "5511999990201", "oi"), { tipo: "ok" });
    assert.deepEqual(recebidos.at(-1), {
      apikey: "chave-teste",
      corpo: { delay: 1200, number: "5511999990201", text: "oi" },
      url: "/message/sendText/inst",
    });
  });

  it("devolve status HTTP de erro", async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      assert.deepEqual(await enviarMensagemEvolution(config, `5511999990${status}`, "oi"), { status, tipo: "http" });
    }
  });

  it("timeout e rede sao distinguidos", async () => {
    assert.deepEqual(await enviarMensagemEvolution(config, "5511999990999", "oi", 50), { tipo: "timeout" });

    const fechado = http.createServer();
    await new Promise((resolve) => fechado.listen(0, "127.0.0.1", resolve));
    const porta = fechado.address().port;
    await new Promise((resolve) => fechado.close(resolve));
    assert.deepEqual(await enviarMensagemEvolution({ ...config, baseUrl: `http://127.0.0.1:${porta}` }, "5511999990201", "oi"), {
      tipo: "rede",
    });
  });
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Mesmas garantias do banco: indice unico (agendamento_id, tipo, canal) e compare-and-set, sincronos apos o await.
function criarRepositorioMemoria({ agendamentos, empresas, comPush = [] }) {
  const mensagens = [];
  const agendamentosEnviados = new Map();
  let sequencia = 0;
  const falharReservaDe = new Set();
  const acharAtiva = (id, empresaId) => mensagens.find((m) => m.id === id && (empresaId === undefined || m.empresa_id === empresaId));

  return {
    agendamentosEnviados,
    falharReservaDe,
    mensagens,
    async buscarAgendamentosComPush(empresaId, ids) {
      await tick();
      return new Set(ids.filter((id) => comPush.includes(id) && agendamentos.some((a) => a.id === id && a.empresa_id === empresaId)));
    },
    async buscarCandidatos(dataLocal) {
      await tick();
      // Nao filtra status de proposito: o processamento tambem precisa barrar cancelado/finalizado.
      return agendamentos.filter((a) => a.data_agendamento.slice(0, 10) === dataLocal).map((a) => ({ ...a }));
    },
    async buscarMensagem(empresaId, agendamentoId, tipo, canal) {
      await tick();
      const m = mensagens.find((x) => x.empresa_id === empresaId && x.agendamento_id === agendamentoId && x.tipo === tipo && x.canal === canal);
      return m ? { claimed_at: m.claimed_at, id: m.id, status: m.status, tentativas: m.tentativas } : null;
    },
    async buscarNomesEmpresas(ids) {
      await tick();
      return new Map(empresas.filter((e) => ids.includes(e.id)).map((e) => [e.id, e.nome]));
    },
    async concluirMensagem(id, empresaId, conclusao) {
      await tick();
      const m = acharAtiva(id, empresaId);
      if (m?.status === "processando") Object.assign(m, conclusao);
    },
    async inserirReserva(empresaId, agendamentoId, tipo, canal, agoraIso) {
      await tick();
      if (falharReservaDe.has(agendamentoId)) throw new Error("banco indisponivel");
      if (mensagens.some((m) => m.agendamento_id === agendamentoId && m.tipo === tipo && m.canal === canal)) return null;
      sequencia += 1;
      mensagens.push({ agendamento_id: agendamentoId, canal, claimed_at: agoraIso, empresa_id: empresaId, id: sequencia, status: "processando", tentativas: 1, tipo });
      return sequencia;
    },
    async marcarAgendamentoEnviado(agendamentoId, empresaId, enviadoEm) {
      await tick();
      agendamentosEnviados.set(agendamentoId, { empresaId, enviadoEm });
    },
    async marcarTravadaComoIncerta(id, limiteIso) {
      await tick();
      const m = acharAtiva(id);
      if (m?.status === "processando" && m.claimed_at < limiteIso) Object.assign(m, { status: "incerto", ultimo_erro: "Processamento interrompido." });
    },
    async reservarNovamente(id, esperado, agoraIso) {
      await tick();
      const m = acharAtiva(id);
      if (!m || m.status !== "erro" || m.tentativas !== esperado.tentativas) return false;
      Object.assign(m, { claimed_at: agoraIso, status: "processando", tentativas: esperado.tentativas + 1 });
      return true;
    },
  };
}

function candidato(id, campos = {}) {
  return {
    aceita_lembrete: true,
    cliente_nome: `Cliente ${id}`,
    cliente_telefone: `11999990${String(id).padStart(3, "0")}`,
    created_at: CRIADO_ONTEM,
    data_agendamento: "2026-09-28T15:00:00+00:00",
    empresa_id: 1,
    id,
    profissional_nome: "João",
    servico_nome: "Corte",
    status: "confirmado",
    ultimo_manual_em: null,
    ...campos,
  };
}

const EMPRESAS = [
  { id: 1, nome: "Barbearia Alfa" },
  { id: 2, nome: "Barbearia Beta" },
];

// respostas: numero -> ResultadoEvolution (ou lista consumida por chamada). Padrao: ok.
function criarEnvio(respostas = {}) {
  const chamadas = [];
  const enviar = async (numero, texto) => {
    chamadas.push({ numero, texto });
    await tick();
    const resposta = respostas[numero];
    if (typeof resposta === "function") return resposta();
    if (Array.isArray(resposta)) return resposta.shift() ?? { tipo: "ok" };
    return resposta ?? { tipo: "ok" };
  };
  return { chamadas, enviar };
}

function executar(repositorio, enviar, extras = {}) {
  return processarLembretesAutomaticos({ agora: AGORA_08H, enviar, repositorio, ...extras });
}

const numero = (id) => `5511999990${String(id).padStart(3, "0")}`;

describe("processamento automatico", () => {
  it("envia reminder_day e reminder_2h com o nome da empresa de cada tenant", async () => {
    const repo = criarRepositorioMemoria({
      agendamentos: [
        candidato(1),
        candidato(2, { data_agendamento: "2026-09-28 10:00:00", profissional_nome: null }),
        candidato(3, { data_agendamento: "2026-09-28T16:00:00+00:00", empresa_id: 2, servico_nome: null, profissional_nome: null }),
      ],
      empresas: EMPRESAS,
    });
    const { chamadas, enviar } = criarEnvio();

    const resumo = await executar(repo, enviar);

    assert.equal(resumo.whatsapp.enviados, 3);
    const textos = Object.fromEntries(chamadas.map((c) => [c.numero, c.texto]));
    assert.equal(
      textos[numero(2)],
      "Olá, Cliente 2! A Barbearia Alfa lembra que seu horário é hoje às 10:00 para Corte. Falta pouco para o seu atendimento. Até já.",
    );
    assert.equal(
      textos[numero(1)],
      "Olá, Cliente 1! A Barbearia Alfa lembra que você tem um horário hoje às 15:00 para Corte, com João. Estamos te esperando.",
    );
    assert.equal(textos[numero(3)], "Olá, Cliente 3! A Barbearia Beta lembra que você tem um horário hoje às 16:00. Estamos te esperando.");
    assert.deepEqual(
      repo.mensagens.map((m) => [m.agendamento_id, m.empresa_id, m.tipo, m.status]).sort(),
      [
        [1, 1, "reminder_day", "enviado"],
        [2, 1, "reminder_2h", "enviado"],
        [3, 2, "reminder_day", "enviado"],
      ],
    );
    assert.equal(repo.agendamentosEnviados.get(3).empresaId, 2);
  });

  it("cancelado, finalizado e criado hoje nao recebem", async () => {
    const repo = criarRepositorioMemoria({
      agendamentos: [
        candidato(1, { status: "cancelado" }),
        candidato(2, { status: "finalizado" }),
        candidato(3, { created_at: "2026-09-28T10:30:00+00:00" }),
        candidato(4, { data_agendamento: "2026-09-29 15:00:00" }),
      ],
      empresas: EMPRESAS,
    });
    const { chamadas, enviar } = criarEnvio();

    const resumo = await executar(repo, enviar);

    assert.equal(resumo.elegiveis, 0);
    assert.deepEqual(chamadas, []);
    assert.deepEqual(repo.mensagens, []);
  });

  it("nao duplica: segunda execucao nao reenvia", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1)], empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio();

    await executar(repo, enviar);
    const segunda = await executar(repo, enviar);

    assert.equal(chamadas.length, 1);
    assert.equal(segunda.whatsapp.jaProcessados, 1);
  });

  it("reminder_day enviado nao impede o reminder_2h depois", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1, { data_agendamento: "2026-09-28 12:00:00" })], empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio();

    await executar(repo, enviar);
    await processarLembretesAutomaticos({ agora: new Date("2026-09-28T13:00:00Z"), enviar, repositorio: repo });

    assert.deepEqual(repo.mensagens.map((m) => m.tipo).sort(), ["reminder_2h", "reminder_day"]);
    assert.equal(chamadas.length, 2);
  });

  it("claim concorrente: duas execucoes simultaneas enviam cada mensagem uma vez", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [1, 2, 3, 4, 5].map((id) => candidato(id)), empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio();

    const [a, b] = await Promise.all([executar(repo, enviar), executar(repo, enviar)]);

    assert.equal(chamadas.length, 5);
    assert.equal(new Set(chamadas.map((c) => c.numero)).size, 5);
    assert.equal(a.whatsapp.enviados + b.whatsapp.enviados, 5);
    assert.equal(a.whatsapp.jaProcessados + b.whatsapp.jaProcessados, 5);
  });

  it("telefone invalido vira ignorado, sem chamar Evolution e sem retry", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1, { cliente_telefone: "123" }), candidato(2)], empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio();

    const resumo = await executar(repo, enviar);
    await executar(repo, enviar);

    assert.equal(resumo.whatsapp.ignorados, 1);
    assert.deepEqual(chamadas.map((c) => c.numero), [numero(2)]);
    assert.equal(repo.mensagens.find((m) => m.agendamento_id === 1).status, "ignorado");
  });

  it("5xx vira erro, tenta de novo na proxima execucao e para em 3 tentativas", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1)], empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio({ [numero(1)]: { status: 503, tipo: "http" } });

    await executar(repo, enviar);
    assert.deepEqual(pick(repo.mensagens[0]), { status: "erro", tentativas: 1 });
    await executar(repo, enviar);
    assert.deepEqual(pick(repo.mensagens[0]), { status: "erro", tentativas: 2 });
    await executar(repo, enviar);
    assert.deepEqual(pick(repo.mensagens[0]), { status: "falha_definitiva", tentativas: 3 });
    await executar(repo, enviar);

    assert.equal(chamadas.length, 3);
  });

  it("5xx seguido de sucesso fica enviado", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1)], empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio({ [numero(1)]: [{ tipo: "rede" }, { tipo: "ok" }] });

    await executar(repo, enviar);
    await executar(repo, enviar);

    assert.equal(chamadas.length, 2);
    assert.deepEqual(pick(repo.mensagens[0]), { status: "enviado", tentativas: 2 });
    assert.ok(repo.agendamentosEnviados.has(1));
  });

  it("timeout vira incerto e nao e reenviado", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1)], empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio({ [numero(1)]: { tipo: "timeout" } });

    const resumo = await executar(repo, enviar);
    await executar(repo, enviar);

    assert.equal(resumo.whatsapp.incertos, 1);
    assert.equal(chamadas.length, 1);
    assert.equal(repo.mensagens[0].status, "incerto");
    assert.equal(repo.agendamentosEnviados.size, 0);
  });

  it("HTTP 400 vira falha_definitiva sem retry", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1)], empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio({ [numero(1)]: { status: 400, tipo: "http" } });

    await executar(repo, enviar);
    await executar(repo, enviar);

    assert.equal(chamadas.length, 1);
    assert.equal(repo.mensagens[0].status, "falha_definitiva");
  });

  for (const status of [401, 403, 404]) {
    it(`HTTP ${status} interrompe a execucao sem consumir tentativa`, async () => {
      const repo = criarRepositorioMemoria({ agendamentos: [1, 2, 3].map((id) => candidato(id)), empresas: EMPRESAS });
      const respostas = { [numero(1)]: [{ status, tipo: "http" }] };
      const { chamadas, enviar } = criarEnvio(respostas);

      const resumo = await executar(repo, enviar);

      assert.equal(resumo.whatsapp.interrompido, "configuracao");
      assert.equal(resumo.whatsapp.statusConfiguracao, status);
      assert.equal(chamadas.length, 1);
      assert.deepEqual(pick(repo.mensagens[0]), { status: "erro", tentativas: 0 });

      const depois = await executar(repo, enviar);
      assert.equal(depois.whatsapp.enviados, 3);
      assert.deepEqual(pick(repo.mensagens.find((m) => m.agendamento_id === 1)), { status: "enviado", tentativas: 1 });
    });
  }

  it("um cliente falha e os outros continuam", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [1, 2, 3].map((id) => candidato(id)), empresas: EMPRESAS });
    repo.falharReservaDe.add(3);
    const { chamadas, enviar } = criarEnvio({
      [numero(1)]: () => {
        throw new Error("inesperado");
      },
    });

    const resumo = await executar(repo, enviar);

    assert.equal(resumo.whatsapp.enviados, 1);
    assert.equal(resumo.whatsapp.erros, 2);
    assert.deepEqual(chamadas.map((c) => c.numero), [numero(1), numero(2)]);
    assert.equal(repo.mensagens.find((m) => m.agendamento_id === 1).status, "erro");
  });

  it("3 falhas seguidas de rede interrompem a execucao", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [1, 2, 3, 4].map((id) => candidato(id)), empresas: EMPRESAS });
    const falha = { tipo: "rede" };
    const { chamadas, enviar } = criarEnvio({ [numero(1)]: falha, [numero(2)]: falha, [numero(3)]: falha });

    const resumo = await executar(repo, enviar);

    assert.equal(resumo.whatsapp.interrompido, "indisponivel");
    assert.equal(chamadas.length, 3);
  });

  it("processando travado ha mais de 10 min vira incerto e nao reenvia", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1), candidato(2)], empresas: EMPRESAS });
    repo.mensagens.push(
      { agendamento_id: 1, claimed_at: "2026-09-28T10:45:00.000Z", empresa_id: 1, id: 100, status: "processando", tentativas: 1, tipo: "reminder_day", canal: "whatsapp" },
      { agendamento_id: 2, claimed_at: "2026-09-28T10:55:00.000Z", empresa_id: 1, id: 101, status: "processando", tentativas: 1, tipo: "reminder_day", canal: "whatsapp" },
    );
    const { chamadas, enviar } = criarEnvio();

    await executar(repo, enviar);

    assert.deepEqual(chamadas, []);
    assert.equal(repo.mensagens.find((m) => m.id === 100).status, "incerto");
    assert.equal(repo.mensagens.find((m) => m.id === 101).status, "processando");
  });

  it("respeita o limite de envios por execucao", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [1, 2, 3].map((id) => candidato(id)), empresas: EMPRESAS });
    const { chamadas, enviar } = criarEnvio();

    const resumo = await executar(repo, enviar, { limiteEnvios: 2 });

    assert.equal(resumo.whatsapp.interrompido, "limite");
    assert.equal(chamadas.length, 2);
  });

  // aceita_lembrete = consentimento de WhatsApp; push depende somente da inscricao do aparelho.
  // Sem inscricao cobre navegador sem suporte a push e Safari/iPhone fora do app instalado.
  const cenariosCanais = [
    ["aceita WhatsApp e recusa push", true, false, true, false],
    ["recusa WhatsApp e aceita push", false, true, false, true],
    ["aceita ambos", true, true, true, true],
    ["recusa ambos", false, false, false, false],
    ["navegador sem suporte a push + WhatsApp marcado", true, false, true, false],
    ["Safari/iPhone sem push + WhatsApp marcado", true, false, true, false],
    ["aceita_lembrete nulo (legado) + push", null, true, false, true],
  ];

  for (const [nome, aceita, inscrito, esperaWhatsApp, esperaPush] of cenariosCanais) {
    it(`canais independentes: ${nome}`, async () => {
      for (const data_agendamento of ["2026-09-28T15:00:00+00:00", "2026-09-28 10:00:00"]) {
        const repo = criarRepositorioMemoria({
          agendamentos: [candidato(1, { aceita_lembrete: aceita, data_agendamento })],
          comPush: inscrito ? [1] : [],
          empresas: EMPRESAS,
        });
        const pushes = [];
        const { chamadas, enviar } = criarEnvio();

        const resumo = await executar(repo, enviar, { enviarPush: async (empresaId, id) => (pushes.push(id), "enviado") });

        assert.equal(chamadas.length, esperaWhatsApp ? 1 : 0, `whatsapp ${data_agendamento}`);
        assert.equal(pushes.length, esperaPush ? 1 : 0, `push ${data_agendamento}`);
        assert.equal(resumo.whatsapp.enviados, esperaWhatsApp ? 1 : 0);
        assert.equal(resumo.push.enviados, esperaPush ? 1 : 0);
        assert.deepEqual(repo.mensagens.map((m) => m.canal).sort(), [...(esperaPush ? ["push"] : []), ...(esperaWhatsApp ? ["whatsapp"] : [])]);
      }
    });
  }

  it("push sem consentimento de WhatsApp segue as mesmas regras de horario e status", async () => {
    const repo = criarRepositorioMemoria({
      agendamentos: [
        candidato(1, { aceita_lembrete: false, status: "cancelado" }),
        candidato(2, { aceita_lembrete: false, data_agendamento: "2026-09-28 10:15:00" }),
        candidato(3, { aceita_lembrete: false, created_at: "2026-09-28T10:30:00+00:00" }),
        candidato(4, { aceita_lembrete: false, ultimo_manual_em: "2026-09-28T10:50:00.000Z" }),
      ],
      comPush: [1, 2, 3, 4],
      empresas: EMPRESAS,
    });
    const pushes = [];

    await executar(repo, criarEnvio().enviar, { enviarPush: async (empresaId, id) => (pushes.push(id), "enviado") });

    assert.deepEqual(pushes, []);
  });

  it("lembrete manual recente impede o automatico em seguida", async () => {
    const repo = criarRepositorioMemoria({
      agendamentos: [candidato(1, { ultimo_manual_em: "2026-09-28T10:50:00.000Z" }), candidato(2)],
      empresas: EMPRESAS,
    });
    const { chamadas, enviar } = criarEnvio();

    await executar(repo, enviar);

    assert.deepEqual(chamadas.map((c) => c.numero), [numero(2)]);
  });

  it("do dia e de 2h saem com pelo menos 90 min de intervalo (cron a cada 15 min)", async () => {
    const horarios = [];
    for (let minutos = 8 * 60 + 30; minutos <= 21 * 60; minutos += 5) {
      horarios.push(`${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`);
    }
    const repo = criarRepositorioMemoria({
      agendamentos: horarios.map((hora, indice) => candidato(indice + 1, { data_agendamento: `2026-09-28 ${hora}:00` })),
      empresas: EMPRESAS,
    });
    const envios = new Map();
    const { enviar } = criarEnvio();

    for (let passo = 0; passo * 15 <= 14 * 60; passo += 1) {
      const agora = new Date(Date.UTC(2026, 8, 28, 10, passo * 15));
      const antes = repo.mensagens.length;
      await processarLembretesAutomaticos({ agora, enviar, limiteEnvios: 500, repositorio: repo });
      for (const m of repo.mensagens.slice(antes)) envios.set(`${m.agendamento_id}:${m.tipo}`, agora.getTime());
    }

    let comAmbos = 0;
    for (let id = 1; id <= horarios.length; id += 1) {
      assert.ok(envios.has(`${id}:reminder_2h`), `2h de ${horarios[id - 1]}`);
      if (!envios.has(`${id}:reminder_day`)) continue;
      comAmbos += 1;
      const intervalo = (envios.get(`${id}:reminder_2h`) - envios.get(`${id}:reminder_day`)) / 60000;
      assert.ok(intervalo >= 90, `${horarios[id - 1]}: ${intervalo} min`);
    }
    assert.ok(comAmbos > 0);
    assert.ok(!envios.has(`${horarios.indexOf("10:15") + 1}:reminder_day`));
    assert.ok(envios.has(`${horarios.indexOf("15:00") + 1}:reminder_day`));
  });

  it("push funciona sem Evolution configurada", async () => {
    const repo = criarRepositorioMemoria({
      agendamentos: [candidato(1), candidato(2, { data_agendamento: "2026-09-28 10:00:00", empresa_id: 2 }), candidato(3)],
      comPush: [1, 2],
      empresas: EMPRESAS,
    });
    const pushes = [];

    const resumo = await processarLembretesAutomaticos({
      agora: AGORA_08H,
      enviarPush: async (empresaId, id) => (pushes.push([empresaId, id]), "enviado"),
      repositorio: repo,
    });

    assert.equal(resumo.whatsapp.ativo, false);
    assert.equal(resumo.push.enviados, 2);
    assert.deepEqual(pushes.sort(), [
      [1, 1],
      [2, 2],
    ]);
    assert.deepEqual(
      repo.mensagens.map((m) => [m.agendamento_id, m.tipo, m.canal, m.status]).sort(),
      [
        [1, "reminder_day", "push", "enviado"],
        [2, "reminder_2h", "push", "enviado"],
      ],
    );
    // Push nao marca o agendamento: o botao manual de WhatsApp continua disponivel.
    assert.equal(repo.agendamentosEnviados.size, 0);
  });

  it("push segue mesmo com a Evolution recusando a configuracao", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1), candidato(2)], comPush: [1, 2], empresas: EMPRESAS });
    const { enviar } = criarEnvio({ [numero(1)]: { status: 401, tipo: "http" } });
    const pushes = [];

    const resumo = await executar(repo, enviar, { enviarPush: async (empresaId, id) => (pushes.push(id), "enviado") });

    assert.equal(resumo.whatsapp.interrompido, "configuracao");
    assert.equal(resumo.push.enviados, 2);
    assert.deepEqual(pushes.sort(), [1, 2]);
  });

  it("WhatsApp funciona com push indisponivel", async () => {
    const falhas = [
      async () => "erro",
      async () => {
        throw new Error("push fora");
      },
    ];

    for (const enviarPush of falhas) {
      const repo = criarRepositorioMemoria({ agendamentos: [candidato(1), candidato(2)], comPush: [1, 2], empresas: EMPRESAS });
      const { chamadas, enviar } = criarEnvio();

      const resumo = await executar(repo, enviar, { enviarPush });

      assert.equal(resumo.whatsapp.enviados, 2);
      assert.equal(chamadas.length, 2);
      assert.equal(resumo.push.enviados, 0);
      assert.ok(repo.mensagens.filter((m) => m.canal === "push").every((m) => m.status === "erro"));
    }

    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1)], comPush: [1], empresas: EMPRESAS });
    repo.buscarAgendamentosComPush = async () => {
      throw new Error("consulta falhou");
    };
    const { chamadas, enviar } = criarEnvio();
    const resumo = await executar(repo, enviar, { enviarPush: async () => "enviado" });
    assert.equal(resumo.push.interrompido, "falha_consulta");
    assert.equal(chamadas.length, 1);
  });

  it("push so reserva quem tem inscricao, reenvia erro e nao duplica", async () => {
    const repo = criarRepositorioMemoria({ agendamentos: [candidato(1), candidato(2)], comPush: [1], empresas: EMPRESAS });
    const respostas = ["erro", "enviado"];
    const pushes = [];
    const enviarPush = async (empresaId, id) => (pushes.push(id), respostas.shift() ?? "enviado");
    const { enviar } = criarEnvio();

    await executar(repo, enviar, { enviarPush });
    await executar(repo, enviar, { enviarPush });
    await executar(repo, enviar, { enviarPush });

    assert.deepEqual(pushes, [1, 1]);
    assert.deepEqual(
      repo.mensagens.filter((m) => m.canal === "push").map((m) => [m.agendamento_id, m.status, m.tentativas]),
      [[1, "enviado", 2]],
    );
    // WhatsApp de cada agendamento saiu uma vez, independente do push.
    assert.equal(repo.mensagens.filter((m) => m.canal === "whatsapp" && m.status === "enviado").length, 2);
  });
});

function pick(mensagem) {
  return { status: mensagem.status, tentativas: mensagem.tentativas };
}
