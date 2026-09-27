process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { registerHooks } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

const raiz = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, raiz).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { formNovoAgendamentoInicial, montarAgendamentoManual } = await import("../lib/agendamentoManual.ts");
const { montarPedidoAgendamentoPublico } = await import("../lib/agendamentoPublico.ts");

describe("agendamento manual do painel", () => {
  const base = { clienteId: 7, empresaId: 1, profissionalId: 3, servicoId: 5 };

  it("formulario comeca com lembrete desmarcado", () => {
    assert.equal(formNovoAgendamentoInicial("2026-09-28").aceitaLembrete, false);
  });

  it("lembrete marcado grava aceita_lembrete = true", () => {
    const form = { ...formNovoAgendamentoInicial("2026-09-28"), aceitaLembrete: true, horario: "15:00" };
    assert.deepEqual(montarAgendamentoManual({ ...base, form }), {
      aceita_lembrete: true,
      cliente_id: 7,
      data_agendamento: "2026-09-28 15:00:00",
      empresa_id: 1,
      profissional_id: 3,
      servico_id: 5,
      status: "confirmado",
    });
  });

  it("lembrete desmarcado grava aceita_lembrete = false", () => {
    const form = { ...formNovoAgendamentoInicial("2026-09-28"), horario: "15:00" };
    assert.equal(montarAgendamentoManual({ ...base, form }).aceita_lembrete, false);
  });

  it("aceita_lembrete vai sempre explicito e booleano, sem depender do default", () => {
    for (const valor of [undefined, null, "true", 1, false]) {
      const payload = montarAgendamentoManual({ ...base, form: { aceitaLembrete: valor, data: "2026-09-28", horario: "15:00" } });
      assert.ok(Object.hasOwn(payload, "aceita_lembrete"), String(valor));
      assert.equal(payload.aceita_lembrete, false, String(valor));
    }
  });

  it("painel usa o helper no estado inicial, no reset, no insert e no checkbox", async () => {
    const pagina = await readFile(new URL("app/page.tsx", raiz), "utf8");

    assert.match(pagina, /useState\(\(\) => formNovoAgendamentoInicial\(dataLocalISO\(\)\)\)/);
    assert.match(pagina, /setNovoAgendamentoForm\(formNovoAgendamentoInicial\(dataLocalISO\(\)\)\)/);
    assert.match(pagina, /from\("agendamentos"\)\.insert\(\s*montarAgendamentoManual\(/);
    assert.match(pagina, /checked=\{novoAgendamentoForm\.aceitaLembrete\}/);
    assert.match(pagina, /Enviar lembretes por WhatsApp/);
    assert.doesNotMatch(pagina, /defaultChecked/);
    // Sem heranca automatica da preferencia do cliente nesta etapa.
    assert.doesNotMatch(pagina, /clientes[^;]*aceita_lembrete/);
  });
});

describe("tela publica: WhatsApp separado do push", () => {
  const pedido = {
    data: "2027-01-04",
    dataNascimento: "",
    empresa: "alfa",
    hora: "09:00",
    nome: "Ana",
    profissionalId: null,
    servicoId: 5,
    telefone: "5511999990000",
  };

  it("aceitaLembrete do pedido vem somente da escolha de WhatsApp", () => {
    assert.equal(montarPedidoAgendamentoPublico({ ...pedido, aceitaLembreteWhatsApp: true }).aceitaLembrete, true);
    assert.equal(montarPedidoAgendamentoPublico({ ...pedido, aceitaLembreteWhatsApp: false }).aceitaLembrete, false);
    for (const valor of [undefined, null, "true", 1]) {
      assert.equal(montarPedidoAgendamentoPublico({ ...pedido, aceitaLembreteWhatsApp: valor }).aceitaLembrete, false, String(valor));
    }
    // Campos de push/notificacao nao existem no pedido e nao influenciam o consentimento.
    const comPermissao = montarPedidoAgendamentoPublico({ ...pedido, aceitaLembreteWhatsApp: false, notificationPermission: "granted", pushAutorizado: true });
    assert.equal(comPermissao.aceitaLembrete, false);
    assert.ok(!Object.keys(comPermissao).some((chave) => /push|notif/i.test(chave)));
  });

  it("pagina liga o consentimento ao checkbox de WhatsApp e o push a permissao do navegador", async () => {
    const pagina = await readFile(new URL("app/agendamentos/page.tsx", raiz), "utf8");

    assert.match(pagina, /const \[aceitaLembreteWhatsApp, setAceitaLembreteWhatsApp\] = useState\(false\);/);
    assert.match(pagina, /const \[pushAutorizado, setPushAutorizado\] = useState\(false\);/);
    // Unico lugar que altera o consentimento de WhatsApp: o checkbox.
    assert.deepEqual(pagina.match(/setAceitaLembreteWhatsApp\(/g), ["setAceitaLembreteWhatsApp("]);
    assert.match(pagina, /checked=\{aceitaLembreteWhatsApp\}\s*onChange=\{\(event\) => setAceitaLembreteWhatsApp\(event\.target\.checked\)\}/);
    assert.match(pagina, /Receber lembretes deste agendamento pelo WhatsApp/);
    assert.match(pagina, /montarPedidoAgendamentoPublico\(\{\s*aceitaLembreteWhatsApp,/);
    // Permissao de notificacao alimenta so o push.
    assert.match(pagina, /setPushAutorizado\(permission === "granted"\)/);
    assert.match(pagina, /if \(!pushAutorizado \|\| !vapidPublicKey \|\| Notification\.permission !== "granted"\)/);
    assert.doesNotMatch(pagina, /aceitaLembreteWhatsApp[^\n]*(permission|Notification|pushAutorizado)/);
    assert.doesNotMatch(pagina, /(permission|Notification|pushAutorizado)[^\n]*setAceitaLembreteWhatsApp/);
    assert.doesNotMatch(pagina, /\baceitaLembrete\b(?!WhatsApp)/);
  });

  it("textos de notificacao nao prometem WhatsApp", async () => {
    const pagina = await readFile(new URL("app/agendamentos/page.tsx", raiz), "utf8");
    const inicio = pagina.indexOf("async function pedirNotificacao");
    const trechoNotificacao = pagina.slice(inicio, pagina.indexOf("async function salvarInscricaoPush"));

    assert.doesNotMatch(trechoNotificacao, /WhatsApp/);
    assert.match(pagina, /Ativar notificações neste dispositivo/);
    assert.doesNotMatch(pagina, /lembrar pelo WhatsApp informado|agendamento pelo WhatsApp\./);
  });
});

// PostgREST falso: suficiente para a rota publica e para o repositorio do cron.
let baseUrl = "";
let tabelas = {};
const sequencias = {};

function filtrar(linhas, params) {
  return linhas.filter((linha) =>
    [...params].every(([coluna, valor]) => {
      if (["select", "order", "limit", "offset", "columns"].includes(coluna)) return true;
      if (valor.startsWith("eq.")) return String(linha[coluna]) === valor.slice(3);
      if (valor.startsWith("neq.")) return String(linha[coluna]) !== valor.slice(4);
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

  const tabela = url.pathname.slice("/rest/v1/".length);
  const objeto = req.headers.accept?.includes("vnd.pgrst.object");

  if (req.method === "POST") {
    const inseridas = [JSON.parse(corpo)].flat().map((linha) => {
      sequencias[tabela] = (sequencias[tabela] || 100) + 1;
      return { id: sequencias[tabela], ...linha };
    });
    tabelas[tabela] = [...(tabelas[tabela] || []), ...inseridas];
    return responder(res, 201, objeto ? inseridas[0] : inseridas);
  }

  if (req.method === "PATCH") {
    const alteradas = filtrar(tabelas[tabela] || [], url.searchParams);
    for (const linha of alteradas) Object.assign(linha, JSON.parse(corpo));
    return responder(res, 200, alteradas);
  }

  let linhas = filtrar(tabelas[tabela] || [], url.searchParams);
  if (tabela === "agendamentos") {
    linhas = linhas.map((linha) => ({
      clientes: tabelas.clientes.find((c) => c.id === linha.cliente_id) || null,
      servicos: tabelas.servicos.find((sv) => sv.id === linha.servico_id) || null,
      ...linha,
    }));
  }
  if (objeto) return linhas.length === 1 ? responder(res, 200, linhas[0]) : responder(res, 406, { code: "PGRST116" });
  return responder(res, 200, linhas);
});

before(async () => {
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${servidor.address().port}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = baseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
});

after(() => servidor.close());

beforeEach(() => {
  tabelas = {
    agendamentos: [],
    clientes: [],
    empresas: [{ ativo: true, dias_atendimento: null, horarios_atendimento: null, id: 1, licenca_expires_at: null, slug: "alfa" }],
    mensagens_whatsapp: [],
    push_subscriptions: [],
    servicos: [{ empresa_id: 1, id: 5, nome: "Corte" }],
  };
});

describe("agendamento publico", () => {
  let POST;
  before(async () => {
    ({ POST } = await import("../app/api/public-booking/route.ts"));
  });

  // 2027-01-04 e segunda-feira, dentro dos dias e horarios padrao.
  function reservar(corpo) {
    return POST(
      new Request("http://localhost/api/public-booking", {
        body: JSON.stringify({ data: "2027-01-04", empresa: "alfa", hora: "09:00", nome: "Ana", servicoId: 5, telefone: "11999990000", ...corpo }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
  }

  for (const [aceitaLembrete, esperado] of [
    [true, true],
    [false, false],
    [undefined, false],
    ["false", false],
    ["true", false],
  ]) {
    it(`continua funcionando e grava aceita_lembrete = ${esperado} (enviado: ${aceitaLembrete})`, async () => {
      const res = await reservar({ aceitaLembrete });

      assert.equal(res.status, 200);
      assert.equal(tabelas.agendamentos.length, 1);
      assert.equal(tabelas.agendamentos[0].aceita_lembrete, esperado);
      assert.equal(tabelas.agendamentos[0].status, "confirmado");
      assert.equal(tabelas.clientes[0].aceita_lembrete, esperado);
    });
  }
});

describe("cron: WhatsApp exige aceita_lembrete = true; push nao", () => {
  it("repositorio devolve todos os confirmados e o WhatsApp filtra pelo consentimento", async () => {
    const { criarRepositorioSupabase } = await import("../lib/lembretesAutomaticos.ts");
    const { getSupabaseServerClient } = await import("../lib/pushReminders.ts");
    const linha = (id, aceita_lembrete) => ({
      aceita_lembrete,
      clientes: { nome: `Cliente ${id}`, telefone: "11999990000" },
      created_at: "2026-09-20 12:00:00",
      data_agendamento: "2026-09-28 15:00:00",
      empresa_id: 1,
      id,
      lembrete_enviado_em: null,
      lembrete_status: null,
      profissionais: null,
      servicos: { nome: "Corte" },
      status: "confirmado",
    });
    tabelas.agendamentos = [linha(1, true), linha(2, false), linha(3, null)];

    const repositorio = criarRepositorioSupabase(getSupabaseServerClient());
    const candidatos = await repositorio.buscarCandidatos("2026-09-28");
    assert.deepEqual(candidatos.map((c) => [c.id, c.aceita_lembrete]), [[1, true], [2, false], [3, null]]);

    const { processarLembretesAutomaticos } = await import("../lib/lembretesAutomaticos.ts");
    const whatsapp = [];
    const push = [];
    const resumo = await processarLembretesAutomaticos({
      agora: new Date("2026-09-28T11:00:00Z"),
      enviar: async (numero, texto) => (whatsapp.push(texto), { tipo: "ok" }),
      enviarPush: async (empresaId, id) => (push.push(id), "enviado"),
      repositorio: { ...repositorio, buscarAgendamentosComPush: async (empresaId, ids) => new Set(ids) },
    });

    assert.equal(resumo.whatsapp.elegiveis, 1);
    assert.equal(whatsapp.length, 1);
    assert.match(whatsapp[0], /^Olá, Cliente 1!/);
    assert.deepEqual(push.sort(), [1, 2, 3]);
  });

  it("agendamento publico com WhatsApp marcado e sem push (ex.: Safari/iPhone) recebe WhatsApp", async () => {
    const { POST } = await import("../app/api/public-booking/route.ts");
    const res = await POST(
      new Request("http://localhost/api/public-booking", {
        body: JSON.stringify({ aceitaLembrete: true, data: "2027-01-04", empresa: "alfa", hora: "09:00", nome: "Ana", servicoId: 5, telefone: "11999990000" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(tabelas.push_subscriptions, []);

    const { criarRepositorioSupabase, processarLembretesAutomaticos } = await import("../lib/lembretesAutomaticos.ts");
    const { getSupabaseServerClient } = await import("../lib/pushReminders.ts");
    const whatsapp = [];
    const push = [];

    // 07:00 locais: faltam 2h para o horario das 09:00.
    const resumo = await processarLembretesAutomaticos({
      agora: new Date("2027-01-04T10:00:00Z"),
      enviar: async (numero, texto) => (whatsapp.push([numero, texto]), { tipo: "ok" }),
      enviarPush: async (empresaId, id) => (push.push(id), "enviado"),
      repositorio: criarRepositorioSupabase(getSupabaseServerClient()),
    });

    assert.equal(resumo.whatsapp.enviados, 1);
    assert.equal(whatsapp[0][0], "5511999990000");
    assert.match(whatsapp[0][1], /hoje às 09:00 para Corte/);
    assert.deepEqual(push, []);
  });
});
