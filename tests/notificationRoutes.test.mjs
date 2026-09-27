import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { registerHooks } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

// Resolve o alias "@/..." do tsconfig e o subpath "next/server" (sem exports no pacote) para importar as rotas reais.
const raiz = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, raiz).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const SEGREDO_SERVICE = "service-role-de-teste";
const SEGREDO_EVOLUTION = "evolution-key-de-teste";

const usuariosPorToken = { "token-dono-a": "user-a", "token-dono-b": "user-b" };
let baseUrl = "";
let tabelas = {};
let enviosWhatsApp = [];
let enviosPush = [];

function fixtures() {
  return {
    empresas: [
      { id: 1, owner_user_id: "user-a" },
      { id: 2, owner_user_id: "user-b" },
    ],
    agendamentos: [
      { id: 10, empresa_id: 1, data_agendamento: "2026-09-28T15:00:00", clientes: { nome: "Ana", telefone: "11999990000" }, servicos: { nome: "Corte" } },
      { id: 11, empresa_id: 1, data_agendamento: "2026-09-28T16:00:00", clientes: { nome: "Falha", telefone: "11900000000" }, servicos: { nome: "Barba" } },
      { id: 20, empresa_id: 2, data_agendamento: "2026-09-28T15:00:00", clientes: { nome: "Bia", telefone: "21988887777" }, servicos: { nome: "Corte" } },
    ],
    push_subscriptions: [
      { empresa_id: 1, agendamento_id: 10, endpoint: `${baseUrl}/push/a` },
      { empresa_id: 2, agendamento_id: 20, endpoint: `${baseUrl}/push/b` },
      // Inscricao forjada pelo navegador: diz ser da empresa 1, mas aponta para agendamento da empresa 2.
      { empresa_id: 1, agendamento_id: 20, endpoint: `${baseUrl}/push/forjada` },
    ],
  };
}

function filtrar(linhas, params) {
  return linhas.filter((linha) =>
    [...params].every(([coluna, valor]) => {
      if (["select", "order", "limit", "offset"].includes(coluna)) return true;
      if (valor.startsWith("eq.")) return String(linha[coluna]) === valor.slice(3);
      if (valor.startsWith("in.(")) return valor.slice(4, -1).split(",").includes(String(linha[coluna]));
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

  if (url.pathname === "/auth/v1/user") {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const userId = usuariosPorToken[token];
    if (!userId) return responder(res, 401, { code: 401, msg: "invalid JWT" });
    return responder(res, 200, { id: userId, aud: "authenticated", role: "authenticated" });
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    assert.equal(req.headers.apikey, SEGREDO_SERVICE);
    const tabela = url.pathname.slice("/rest/v1/".length);
    return responder(res, 200, filtrar(tabelas[tabela] || [], url.searchParams));
  }

  if (url.pathname === "/evo/message/sendText/instancia") {
    assert.equal(req.headers.apikey, SEGREDO_EVOLUTION);
    const payload = JSON.parse(corpo);
    enviosWhatsApp.push(payload.number);
    if (payload.number === "5511900000000") return responder(res, 500, { error: "falha simulada" });
    return responder(res, 201, {});
  }

  if (url.pathname.startsWith("/push/")) {
    enviosPush.push(url.pathname.slice("/push/".length));
    return responder(res, 201, {});
  }

  responder(res, 404, {});
});

function gerarChavesVapid() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwkPublica = publicKey.export({ format: "jwk" });
  const bruta = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwkPublica.x, "base64url"),
    Buffer.from(jwkPublica.y, "base64url"),
  ]);
  return { privada: privateKey.export({ format: "jwk" }).d, publica: bruta.toString("base64url") };
}

function requisicao(caminho, corpo, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`http://localhost${caminho}`, { body: JSON.stringify(corpo), headers, method: "POST" });
}

let whatsappPost;
let pushPost;

before(async () => {
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${servidor.address().port}`;

  const vapid = gerarChavesVapid();
  process.env.NEXT_PUBLIC_SUPABASE_URL = baseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-de-teste";
  process.env.SUPABASE_SERVICE_ROLE_KEY = SEGREDO_SERVICE;
  process.env.EVOLUTION_API_URL = `${baseUrl}/evo/`;
  process.env.EVOLUTION_API_KEY = SEGREDO_EVOLUTION;
  process.env.EVOLUTION_API_INSTANCE = "instancia";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publica;
  process.env.VAPID_PRIVATE_KEY = vapid.privada;

  ({ POST: whatsappPost } = await import("../app/api/whatsapp/reminders/route.ts"));
  ({ POST: pushPost } = await import("../app/api/push/reminders/route.ts"));
});

after(() => servidor.close());

beforeEach(() => {
  tabelas = fixtures();
  enviosWhatsApp = [];
  enviosPush = [];
});

describe("POST /api/whatsapp/reminders", () => {
  const caminho = "/api/whatsapp/reminders";

  it("sem token retorna 401 e nao envia nada", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [10], empresaId: 1 }));
    assert.equal(res.status, 401);
    assert.deepEqual(enviosWhatsApp, []);
  });

  it("token invalido retorna 401 e nao envia nada", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [10], empresaId: 1 }, "token-falso"));
    assert.equal(res.status, 401);
    assert.deepEqual(enviosWhatsApp, []);
  });

  it("empresa de outro tenant retorna 403 e nao envia nada", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [20], empresaId: 2 }, "token-dono-a"));
    assert.equal(res.status, 403);
    assert.deepEqual(enviosWhatsApp, []);
  });

  it("dono da empresa envia o lembrete do proprio agendamento", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [10], empresaId: 1 }, "token-dono-a"));
    const dados = await res.json();
    assert.equal(res.status, 200);
    assert.equal(dados.configured, true);
    assert.deepEqual(dados.sentAppointmentIds, [10]);
    assert.deepEqual(enviosWhatsApp, ["5511999990000"]);
  });

  it("ignora IDs de agendamento de outra empresa", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [10, 20], empresaId: 1 }, "token-dono-a"));
    const dados = await res.json();
    assert.deepEqual(dados.sentAppointmentIds, [10]);
    assert.deepEqual(enviosWhatsApp, ["5511999990000"]);
  });

  it("falha em um ID nao libera envio cross-tenant", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [11, 10, 20], empresaId: 1 }, "token-dono-a"));
    const dados = await res.json();
    assert.equal(dados.failed, 1);
    assert.deepEqual(dados.sentAppointmentIds, [10]);
    assert.deepEqual(enviosWhatsApp.sort(), ["5511900000000", "5511999990000"]);
  });

  it("lista de IDs vazia ou invalida retorna 400 para usuario autorizado", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: ["x", -1], empresaId: 1 }, "token-dono-a"));
    assert.equal(res.status, 400);
    assert.deepEqual(enviosWhatsApp, []);
  });

  it("resposta nao expoe segredos", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [11, 10], empresaId: 1 }, "token-dono-a"));
    const texto = await res.text();
    assert.ok(!texto.includes(SEGREDO_EVOLUTION));
    assert.ok(!texto.includes(SEGREDO_SERVICE));
  });
});

describe("POST /api/push/reminders", () => {
  const caminho = "/api/push/reminders";

  it("sem token retorna 401 e nao envia nada", async () => {
    const res = await pushPost(requisicao(caminho, { agendamentoIds: [10], empresaId: 1 }));
    assert.equal(res.status, 401);
    assert.deepEqual(enviosPush, []);
  });

  it("token invalido retorna 401 e nao envia nada", async () => {
    const res = await pushPost(requisicao(caminho, { agendamentoIds: [10], empresaId: 1 }, "token-falso"));
    assert.equal(res.status, 401);
    assert.deepEqual(enviosPush, []);
  });

  it("empresa de outro tenant retorna 403 e nao envia nada", async () => {
    const res = await pushPost(requisicao(caminho, { agendamentoIds: [20], empresaId: 2 }, "token-dono-a"));
    assert.equal(res.status, 403);
    assert.deepEqual(enviosPush, []);
  });

  it("dono da empresa envia push do proprio agendamento", async () => {
    const res = await pushPost(requisicao(caminho, { agendamentoIds: [10], empresaId: 1 }, "token-dono-a"));
    const dados = await res.json();
    assert.equal(res.status, 200);
    assert.equal(dados.sent, 1);
    assert.deepEqual(enviosPush, ["a"]);
  });

  it("ignora agendamento de outra empresa mesmo com inscricao forjada", async () => {
    const res = await pushPost(requisicao(caminho, { agendamentoIds: [10, 20], empresaId: 1 }, "token-dono-a"));
    const dados = await res.json();
    assert.equal(dados.sent, 1);
    assert.deepEqual(enviosPush, ["a"]);
  });

  it("somente IDs de outra empresa nao envia nada", async () => {
    const res = await pushPost(requisicao(caminho, { agendamentoIds: [20], empresaId: 1 }, "token-dono-a"));
    const dados = await res.json();
    assert.equal(res.status, 200);
    assert.equal(dados.sent, 0);
    assert.deepEqual(enviosPush, []);
  });
});
