// Rota /api/cron/reminders como o scheduler externo (pg_cron + pg_net) vai chamar: GET com Authorization Bearer.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { createRequire, registerHooks } from "node:module";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";

const raiz = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, raiz).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const SEGREDO_CRON = "cron-secret-de-teste";
const SEGREDO_SERVICE = "service-role-de-teste";
const SEGREDO_EVOLUTION = "evolution-key-de-teste";
// 08:00 em Sao Paulo: 15:00 recebe o lembrete do dia e 10:00 o de 2h.
const AGORA = new Date("2026-09-28T11:00:00Z");

let baseUrl = "";
let tabelas = {};
let enviosWhatsApp = [];
let enviosPush = [];
let escritas = [];
let evolutionFora = false;
let pushFora = false;
let sequencia = 100;

function chavesInscricao() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { auth: crypto.randomBytes(16).toString("base64url"), p256dh: ecdh.getPublicKey().toString("base64url") };
}

function agendamento(id, hora) {
  return {
    aceita_lembrete: true,
    clientes: { nome: `Cliente ${id}`, telefone: "11999990000" },
    created_at: "2026-09-20 12:00:00",
    data_agendamento: `2026-09-28 ${hora}:00`,
    empresa_id: 1,
    id,
    lembrete_enviado_em: null,
    lembrete_status: null,
    profissionais: null,
    servicos: { nome: "Corte" },
    status: "confirmado",
  };
}

function fixtures() {
  return {
    agendamentos: [agendamento(10, "15:00"), agendamento(11, "10:00")],
    empresas: [{ id: 1, nome: "Barbearia Alfa" }],
    mensagens_whatsapp: [],
    push_subscriptions: [
      { agendamento_id: 10, empresa_id: 1, endpoint: `${baseUrl}/push/10`, ...chavesInscricao() },
      { agendamento_id: 11, empresa_id: 1, endpoint: `${baseUrl}/push/11`, ...chavesInscricao() },
    ],
  };
}

function filtrar(linhas, params) {
  return linhas.filter((linha) =>
    [...params].every(([coluna, valor]) => {
      if (["select", "order", "limit", "offset", "columns"].includes(coluna)) return true;
      if (valor.startsWith("eq.")) return String(linha[coluna]) === valor.slice(3);
      if (valor.startsWith("in.(")) return valor.slice(4, -1).split(",").includes(String(linha[coluna]));
      if (valor.startsWith("gte.")) return String(linha[coluna]) >= valor.slice(4);
      if (valor.startsWith("lte.")) return String(linha[coluna]) <= valor.slice(4);
      if (valor.startsWith("lt.")) return String(linha[coluna]) < valor.slice(3);
      if (valor === "is.null") return linha[coluna] == null;
      throw new Error(`Filtro nao suportado no fake: ${coluna}=${valor}`);
    }),
  );
}

function responder(res, status, corpo) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corpo));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, baseUrl);
  let corpo = "";
  for await (const parte of req) corpo += parte;

  if (url.pathname.startsWith("/rest/v1/")) {
    assert.equal(req.headers.apikey, SEGREDO_SERVICE);
    const tabela = url.pathname.slice("/rest/v1/".length);
    const objeto = req.headers.accept?.includes("vnd.pgrst.object");

    if (req.method !== "GET" && req.method !== "HEAD") escritas.push(`${req.method} ${tabela}`);

    if (req.method === "POST") {
      const nova = JSON.parse(corpo);
      // Indice unico parcial (agendamento_id, tipo, canal) da migration.
      const duplicada = tabelas[tabela].some(
        (m) => ["reminder_day", "reminder_2h"].includes(nova.tipo) && m.agendamento_id === nova.agendamento_id && m.tipo === nova.tipo && m.canal === nova.canal,
      );
      if (duplicada) return responder(res, 409, { code: "23505", message: "duplicate key" });
      const linha = { id: (sequencia += 1), ...nova };
      tabelas[tabela].push(linha);
      return responder(res, 201, objeto ? linha : [linha]);
    }

    if (req.method === "PATCH") {
      const alteradas = filtrar(tabelas[tabela], url.searchParams);
      for (const linha of alteradas) Object.assign(linha, JSON.parse(corpo));
      return responder(res, 200, alteradas);
    }

    const linhas = filtrar(tabelas[tabela] || [], url.searchParams);
    if (objeto) return linhas.length === 1 ? responder(res, 200, linhas[0]) : responder(res, 406, { code: "PGRST116" });
    return responder(res, 200, linhas);
  }

  if (url.pathname === "/evo/message/sendText/instancia") {
    assert.equal(req.headers.apikey, SEGREDO_EVOLUTION);
    if (evolutionFora) return responder(res, 503, { error: "indisponivel" });
    enviosWhatsApp.push(JSON.parse(corpo));
    return responder(res, 201, {});
  }

  responder(res, 404, {});
});

function gerarChavesVapid() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const bruta = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { privada: privateKey.export({ format: "jwk" }).d, publica: bruta.toString("base64url") };
}

// web-push so fala HTTPS; o servico de push do navegador e simulado na propria biblioteca (mesma instancia usada pela rota).
const webpush = createRequire(import.meta.url)("web-push");
webpush.sendNotification = async (inscricao) => {
  if (pushFora) throw Object.assign(new Error("push indisponivel"), { statusCode: 500 });
  enviosPush.push(Number(inscricao.endpoint.split("/").pop()));
  return { statusCode: 201 };
};

let GET;

function chamar(headers = {}, consulta = "") {
  return GET(new Request(`https://bmssistema-sss2.vercel.app/api/cron/reminders${consulta}`, { headers, method: "GET" }));
}

const autorizado = () => chamar({ Authorization: `Bearer ${SEGREDO_CRON}` });

before(async () => {
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${servidor.address().port}`;

  const vapid = gerarChavesVapid();
  process.env.CRON_SECRET = SEGREDO_CRON;
  process.env.NEXT_PUBLIC_SUPABASE_URL = baseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SEGREDO_SERVICE;
  process.env.EVOLUTION_API_URL = `${baseUrl}/evo/`;
  process.env.EVOLUTION_API_KEY = SEGREDO_EVOLUTION;
  process.env.EVOLUTION_API_INSTANCE = "instancia";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publica;
  process.env.VAPID_PRIVATE_KEY = vapid.privada;
  process.env.VAPID_SUBJECT = "mailto:teste@example.com";

  ({ GET } = await import("../app/api/cron/reminders/route.ts"));
});

after(() => servidor.close());

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: AGORA });
  process.env.CRON_SECRET = SEGREDO_CRON;
  tabelas = fixtures();
  enviosWhatsApp = [];
  enviosPush = [];
  escritas = [];
  evolutionFora = false;
  pushFora = false;
});

afterEach(() => mock.timers.reset());

describe("GET /api/cron/reminders: autenticacao", () => {
  for (const [nome, headers] of [
    ["sem Authorization", {}],
    ["token incorreto", { Authorization: "Bearer outro-segredo" }],
    ["token sem Bearer", { Authorization: SEGREDO_CRON }],
    ["token com prefixo extra", { Authorization: `Bearer ${SEGREDO_CRON}x` }],
    ["segredo em outro header", { "x-cron-secret": SEGREDO_CRON }],
  ]) {
    it(`${nome} retorna 401 e nao envia nada`, async () => {
      const res = await chamar(headers);

      assert.equal(res.status, 401);
      assert.deepEqual(enviosWhatsApp, []);
      assert.deepEqual(enviosPush, []);
      assert.deepEqual(tabelas.mensagens_whatsapp, []);
    });
  }

  it("CRON_SECRET ausente no servidor recusa qualquer chamada", async () => {
    delete process.env.CRON_SECRET;
    for (const headers of [{}, { Authorization: "Bearer " }, { Authorization: "Bearer undefined" }]) {
      assert.equal((await chamar(headers)).status, 401);
    }
    assert.deepEqual(enviosWhatsApp, []);
  });
});

describe("GET /api/cron/reminders: chamada autenticada", () => {
  it("envia reminder_day e reminder_2h pelos dois canais", async () => {
    const res = await autorizado();
    const dados = await res.json();

    assert.equal(res.status, 200);
    assert.equal(dados.whatsappConfigured, true);
    assert.equal(dados.pushConfigured, true);
    assert.equal(dados.whatsapp.enviados, 2);
    assert.equal(dados.push.enviados, 2);
    assert.deepEqual(enviosPush.sort(), [10, 11]);
    assert.deepEqual(
      tabelas.mensagens_whatsapp.map((m) => [m.agendamento_id, m.tipo, m.canal, m.status]).sort(),
      [
        [10, "reminder_day", "push", "enviado"],
        [10, "reminder_day", "whatsapp", "enviado"],
        [11, "reminder_2h", "push", "enviado"],
        [11, "reminder_2h", "whatsapp", "enviado"],
      ],
    );
    assert.ok(enviosWhatsApp.some((p) => /hoje às 15:00/.test(p.text)));
    assert.ok(enviosWhatsApp.some((p) => /hoje às 10:00/.test(p.text)));
  });

  it("chamadas repetidas (ex.: job duplicado ou reexecucao) nao duplicam envios", async () => {
    const respostas = await Promise.all([autorizado(), autorizado(), autorizado()]);
    await autorizado();

    assert.deepEqual(respostas.map((r) => r.status), [200, 200, 200]);
    assert.equal(enviosWhatsApp.length, 2);
    assert.equal(enviosPush.length, 2);
    assert.equal(tabelas.mensagens_whatsapp.length, 4);
  });

  it("Evolution indisponivel nao impede o push", async () => {
    evolutionFora = true;
    const res = await autorizado();
    const dados = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(enviosWhatsApp, []);
    assert.equal(dados.whatsapp.enviados, 0);
    assert.deepEqual(enviosPush.sort(), [10, 11]);
    assert.equal(dados.push.enviados, 2);
  });

  it("Evolution sem configuracao nao impede o push", async () => {
    const url = process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_URL;
    try {
      const dados = await (await autorizado()).json();
      assert.equal(dados.whatsappConfigured, false);
      assert.deepEqual(enviosPush.sort(), [10, 11]);
    } finally {
      process.env.EVOLUTION_API_URL = url;
    }
  });

  it("push indisponivel nao impede o WhatsApp", async () => {
    pushFora = true;
    const res = await autorizado();
    const dados = await res.json();

    assert.equal(res.status, 200);
    assert.equal(enviosWhatsApp.length, 2);
    assert.equal(dados.whatsapp.enviados, 2);
    assert.equal(dados.push.enviados, 0);
  });

  it("resposta (gravada pelo pg_net) nao expoe telefone, texto nem segredos", async () => {
    const texto = await (await autorizado()).text();

    for (const proibido of ["11999990000", "5511999990000", "Cliente 10", SEGREDO_CRON, SEGREDO_EVOLUTION, SEGREDO_SERVICE, "instancia", baseUrl]) {
      assert.ok(!texto.includes(proibido), proibido);
    }
  });
});

describe("GET /api/cron/reminders?dryRun=1", () => {
  const dryRun = (consulta = "?dryRun=1", token = SEGREDO_CRON) => chamar({ Authorization: `Bearer ${token}` }, consulta);

  function cenarioMisto() {
    const semConsentimento = { ...agendamento(12, "16:00"), aceita_lembrete: false };
    const telefoneInvalido = { ...agendamento(13, "09:30"), clientes: { nome: "Cliente 13", telefone: "123" } };
    const cedoDemais = agendamento(14, "08:20");
    const cancelado = { ...agendamento(15, "15:30"), status: "cancelado" };
    tabelas.agendamentos.push(semConsentimento, telefoneInvalido, cedoDemais, cancelado);
    tabelas.push_subscriptions.push({ agendamento_id: 12, empresa_id: 1, endpoint: `${baseUrl}/push/12`, ...chavesInscricao() });
  }

  function semEfeitos(antes) {
    assert.deepEqual(escritas, []);
    assert.deepEqual(enviosWhatsApp, []);
    assert.deepEqual(enviosPush, []);
    assert.deepEqual(tabelas, antes);
  }

  for (const [nome, headers] of [
    ["sem Authorization", {}],
    ["token incorreto", { Authorization: "Bearer outro-segredo" }],
  ]) {
    it(`${nome} retorna 401 sem ler nem escrever nada`, async () => {
      const antes = structuredClone(tabelas);
      const res = await chamar(headers, "?dryRun=1");

      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Nao autorizado." });
      semEfeitos(antes);
    });
  }

  it("token correto retorna 200 so com contagens e sem efeito colateral", async () => {
    cenarioMisto();
    const antes = structuredClone(tabelas);

    const res = await dryRun();
    const dados = await res.json();

    assert.equal(res.status, 200);
    // 10 (dia) e 11 (2h) com consentimento; 12 sem consentimento; 13 telefone invalido; 14 fora da janela; 15 cancelado.
    // Push: 10, 11 e 12 (push nao depende do consentimento de WhatsApp).
    assert.deepEqual(dados, {
      dryRun: true,
      pushConfigured: true,
      pushEligible: 3,
      reminder2hEligible: 1,
      reminderDayEligible: 1,
      verificados: 5,
      whatsappConfigured: true,
    });
    semEfeitos(antes);
  });

  for (const consulta of ["?dryRun=true", "?dryRun=0", "?dryRun", "?x=1&dryRun=1"]) {
    it(`${consulta} tambem e dry run (nunca cai no envio real)`, async () => {
      const antes = structuredClone(tabelas);
      const dados = await (await dryRun(consulta)).json();

      assert.equal(dados.dryRun, true);
      semEfeitos(antes);
    });
  }

  it("com Evolution ou push fora do ar continua sem chamar nenhum dos dois", async () => {
    evolutionFora = true;
    pushFora = true;
    const antes = structuredClone(tabelas);

    assert.equal((await dryRun()).status, 200);
    semEfeitos(antes);
  });

  it("depois da execucao real, o que ja foi enviado deixa de contar", async () => {
    cenarioMisto();
    await autorizado();
    assert.equal(enviosWhatsApp.length, 2);
    assert.equal(enviosPush.length, 3);

    enviosWhatsApp = [];
    enviosPush = [];
    escritas = [];
    const antes = structuredClone(tabelas);
    const dados = await (await dryRun()).json();

    assert.equal(dados.reminderDayEligible, 0);
    assert.equal(dados.reminder2hEligible, 0);
    assert.equal(dados.pushEligible, 0);
    semEfeitos(antes);
  });

  it("mensagem em erro com tentativas sobrando volta a contar, como no envio real", async () => {
    tabelas.mensagens_whatsapp.push(
      { agendamento_id: 10, canal: "whatsapp", empresa_id: 1, id: 1, status: "erro", tentativas: 1, tipo: "reminder_day" },
      { agendamento_id: 11, canal: "whatsapp", empresa_id: 1, id: 2, status: "falha_definitiva", tentativas: 3, tipo: "reminder_2h" },
    );
    const dados = await (await dryRun()).json();

    assert.equal(dados.reminderDayEligible, 1);
    assert.equal(dados.reminder2hEligible, 0);
    assert.deepEqual(escritas, []);
  });

  it("resposta nao expoe telefone, nome, servico, IDs nem segredos", async () => {
    cenarioMisto();
    const texto = await (await dryRun()).text();

    for (const proibido of ["11999990000", "Cliente", "Corte", "Barbearia", "agendamento", "push/", SEGREDO_CRON, SEGREDO_EVOLUTION, SEGREDO_SERVICE, baseUrl]) {
      assert.ok(!texto.includes(proibido), proibido);
    }
    assert.ok(Object.values(JSON.parse(texto)).every((valor) => typeof valor === "number" || typeof valor === "boolean"));
  });
});
