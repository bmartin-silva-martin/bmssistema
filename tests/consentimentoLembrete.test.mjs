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

  const linhas = filtrar(tabelas[tabela] || [], url.searchParams);
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
    servicos: [{ empresa_id: 1, id: 5 }],
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

describe("cron considera somente aceita_lembrete = true", () => {
  it("repositorio do cron filtra no banco por aceita_lembrete = true", async () => {
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

    const candidatos = await criarRepositorioSupabase(getSupabaseServerClient()).buscarCandidatos("2026-09-28");

    assert.deepEqual(candidatos.map((c) => [c.id, c.aceita_lembrete]), [[1, true]]);
  });
});
