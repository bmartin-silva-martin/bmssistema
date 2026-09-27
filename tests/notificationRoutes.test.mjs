// Simula o runtime da Vercel (UTC): o horario do lembrete manual nao pode depender do fuso do processo.
process.env.TZ = "UTC";

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
let textosWhatsApp = [];
let enviosPush = [];

function fixtures() {
  return {
    empresas: [
      { id: 1, nome: "Barbearia Alfa", owner_user_id: "user-a" },
      { id: 2, nome: "Barbearia Beta", owner_user_id: "user-b" },
    ],
    agendamentos: [
      agendamentoFixture(10, 1, "2026-09-28 15:00:00", "Ana", "11999990000", "Corte", "João"),
      agendamentoFixture(11, 1, "2026-09-28 16:00:00", "Falha", "11900000000", "Barba", null),
      agendamentoFixture(12, 1, "2026-09-28 17:00:00", "Fim", "11977776666", "Corte", null, "finalizado"),
      agendamentoFixture(20, 2, "2026-09-28 15:00:00", "Bia", "21988887777", "Corte", null),
    ],
    mensagens_whatsapp: [],
    push_subscriptions: [
      { empresa_id: 1, agendamento_id: 10, endpoint: `${baseUrl}/push/a` },
      { empresa_id: 2, agendamento_id: 20, endpoint: `${baseUrl}/push/b` },
      // Inscricao forjada pelo navegador: diz ser da empresa 1, mas aponta para agendamento da empresa 2.
      { empresa_id: 1, agendamento_id: 20, endpoint: `${baseUrl}/push/forjada` },
    ],
  };
}

function agendamentoFixture(id, empresaId, data, cliente, telefone, servico, profissional, status = "confirmado") {
  return {
    aceita_lembrete: true,
    clientes: { nome: cliente, telefone },
    created_at: "2026-09-20T12:00:00+00:00",
    data_agendamento: data,
    empresa_id: empresaId,
    id,
    lembrete_enviado_em: null,
    lembrete_status: null,
    profissionais: profissional ? { nome: profissional } : null,
    servicos: { nome: servico },
    status,
  };
}

function filtrar(linhas, params) {
  return linhas.filter((linha) =>
    [...params].every(([coluna, valor]) => {
      if (["select", "order", "limit", "offset"].includes(coluna)) return true;
      if (valor.startsWith("eq.")) return String(linha[coluna]) === valor.slice(3);
      if (valor.startsWith("in.(")) return valor.slice(4, -1).split(",").includes(String(linha[coluna]));
      if (valor.startsWith("gte.")) return String(linha[coluna]) >= valor.slice(4);
      if (valor.startsWith("lte.")) return String(linha[coluna]) <= valor.slice(4);
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

    if (req.method === "POST") {
      tabelas[tabela] = [...(tabelas[tabela] || []), ...[JSON.parse(corpo)].flat()];
      res.writeHead(201);
      return res.end();
    }

    const linhas = filtrar(tabelas[tabela] || [], url.searchParams);
    if (req.headers.accept?.includes("vnd.pgrst.object")) {
      return linhas.length === 1 ? responder(res, 200, linhas[0]) : responder(res, 406, { code: "PGRST116" });
    }
    return responder(res, 200, linhas);
  }

  if (url.pathname === "/evo/message/sendText/instancia") {
    assert.equal(req.headers.apikey, SEGREDO_EVOLUTION);
    const payload = JSON.parse(corpo);
    enviosWhatsApp.push(payload.number);
    textosWhatsApp.push(payload.text);
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
  textosWhatsApp = [];
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

  it("texto manual usa horario local, empresa, servico e profissional", async () => {
    await whatsappPost(requisicao(caminho, { agendamentoIds: [10, 11], empresaId: 1 }, "token-dono-a"));
    const texto = textosWhatsApp[enviosWhatsApp.indexOf("5511999990000")];

    assert.match(texto, /^Olá, Ana! A Barbearia Alfa lembra que você tem um horário (hoje|amanhã|no dia 28\/09) às 15:00 para Corte, com João\. Estamos te esperando\.$/);
    for (const enviado of textosWhatsApp) assert.doesNotMatch(enviado, /null|undefined|12:00|Invalid/);
  });

  it("nao envia lembrete manual para agendamento finalizado", async () => {
    const res = await whatsappPost(requisicao(caminho, { agendamentoIds: [12], empresaId: 1 }, "token-dono-a"));
    const dados = await res.json();
    assert.deepEqual(dados.sentAppointmentIds, []);
    assert.deepEqual(enviosWhatsApp, []);
  });

  it("registra manual_reminder somente para o envio que deu certo", async () => {
    await whatsappPost(requisicao(caminho, { agendamentoIds: [10, 11], empresaId: 1 }, "token-dono-a"));

    assert.deepEqual(
      tabelas.mensagens_whatsapp.map((m) => [m.agendamento_id, m.empresa_id, m.tipo, m.canal, m.status, Boolean(m.enviado_em)]),
      [[10, 1, "manual_reminder", "whatsapp", "enviado", true]],
    );
  });

  it("envio manual impede o automatico equivalente logo depois", async () => {
    await whatsappPost(requisicao(caminho, { agendamentoIds: [10], empresaId: 1 }, "token-dono-a"));

    const { criarRepositorioSupabase } = await import("../lib/lembretesAutomaticos.ts");
    const { getSupabaseServerClient } = await import("../lib/pushReminders.ts");
    const { tipoLembreteElegivel } = await import("../lib/lembretesWhatsApp.ts");
    const candidatos = await criarRepositorioSupabase(getSupabaseServerClient()).buscarCandidatos("2026-09-28");
    const manual = candidatos.find((c) => c.id === 10);
    const semManual = candidatos.find((c) => c.id === 11);

    assert.ok(manual.ultimo_manual_em);
    assert.equal(semManual.ultimo_manual_em, null);
    assert.equal(manual.profissional_nome, "João");

    // Manual as 08:00 locais: sem lembrete do dia em seguida; o de 2h (13:00) so sai por estar 5h depois do manual.
    const cenario = { ...manual, ultimo_manual_em: "2026-09-28T11:00:00.000Z" };
    assert.equal(tipoLembreteElegivel({ ...semManual, data_agendamento: "2026-09-28 15:00:00" }, new Date("2026-09-28T11:15:00Z")), "reminder_day");
    assert.equal(tipoLembreteElegivel(cenario, new Date("2026-09-28T11:15:00Z")), null);
    assert.equal(tipoLembreteElegivel(cenario, new Date("2026-09-28T16:00:00Z")), "reminder_2h");
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
