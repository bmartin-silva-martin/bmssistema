import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anosDisponiveis,
  calcularPendencias,
  calcularUpsellProduto,
  contarDiasAbertosNoIntervalo,
  detalharFormaPagamento,
  filtrarAgendamentosPorIntervalo,
  filtrarAgendamentosPorVisao,
  filtrarVendasPorIntervalo,
  filtrarVendasPorVisao,
  FORMA_PAGAMENTO_NAO_INFORMADA,
  resolverIntervaloFinanceiro,
} from "../lib/financeiro.ts";

const AGORA = new Date(2026, 8, 25, 15, 0, 0); // 25/09/2026 15:00 local

function venda(id, createdAt, extra = {}) {
  return { agendamento_id: id * 10, created_at: createdAt, id, total: 50, venda_itens: [], ...extra };
}

describe("filtro mensal", () => {
  it("usa o mes inteiro no horario local", () => {
    const intervalo = resolverIntervaloFinanceiro("hoje", { month: 9, year: 2026 }, AGORA);
    assert.deepEqual(intervalo.inicio, new Date(2026, 8, 1));
    assert.deepEqual(intervalo.fim, new Date(2026, 9, 1));
    assert.equal(intervalo.dias, 30);
    assert.match(intervalo.descricao, /Setembro\/2026 \(01\/09\/2026 a 30\/09\/2026\)/);
  });

  it("respeita os limites do mes para vendas (timestamptz) e agendamentos (timestamp local)", () => {
    const intervalo = resolverIntervaloFinanceiro("todos", { month: 9, year: 2026 }, AGORA);
    const vendas = [
      venda(1, new Date(2026, 7, 31, 23, 59).toISOString()),
      venda(2, new Date(2026, 8, 1, 0, 0).toISOString()),
      venda(3, new Date(2026, 8, 30, 23, 59).toISOString()),
      venda(4, new Date(2026, 9, 1, 0, 0).toISOString()),
    ];
    assert.deepEqual(filtrarVendasPorIntervalo(vendas, intervalo).map((v) => v.id), [2, 3]);

    const agendamentos = [
      { data_agendamento: "2026-08-31 23:30:00", status: "finalizado" },
      { data_agendamento: "2026-09-01 09:00:00", status: "finalizado" },
      { data_agendamento: "2026-10-01 09:00:00", status: "confirmado" },
    ];
    assert.equal(filtrarAgendamentosPorIntervalo(agendamentos, intervalo).length, 1);
  });

  it("troca de ano separa o mesmo mes de anos diferentes", () => {
    const vendas = [venda(1, new Date(2025, 0, 15).toISOString()), venda(2, new Date(2026, 0, 15).toISOString())];
    const jan2025 = resolverIntervaloFinanceiro("todos", { month: 1, year: 2025 }, AGORA);
    const jan2026 = resolverIntervaloFinanceiro("todos", { month: 1, year: 2026 }, AGORA);
    assert.deepEqual(filtrarVendasPorIntervalo(vendas, jan2025).map((v) => v.id), [1]);
    assert.deepEqual(filtrarVendasPorIntervalo(vendas, jan2026).map((v) => v.id), [2]);

    const dez2025 = resolverIntervaloFinanceiro("todos", { month: 12, year: 2025 }, AGORA);
    assert.deepEqual(dez2025.fim, new Date(2026, 0, 1));
  });

  it("fevereiro bissexto e dias de atendimento", () => {
    assert.equal(resolverIntervaloFinanceiro("hoje", { month: 2, year: 2028 }, AGORA).dias, 29);
    // Setembro/2026: 30 dias, 4 domingos (6, 13, 20, 27).
    const setembro = resolverIntervaloFinanceiro("hoje", { month: 9, year: 2026 }, AGORA);
    assert.equal(contarDiasAbertosNoIntervalo(setembro, [1, 2, 3, 4, 5, 6]), 26);
  });

  it("mes invalido cai no periodo relativo e mantem Hoje/7/30/Tudo", () => {
    assert.equal(resolverIntervaloFinanceiro("7", { month: 13, year: 2026 }, AGORA).dias, 7);
    const hoje = resolverIntervaloFinanceiro("hoje", null, AGORA);
    assert.deepEqual(hoje.inicio, new Date(2026, 8, 25));
    assert.equal(hoje.fim, null);
    assert.deepEqual(resolverIntervaloFinanceiro("30", null, AGORA).inicio, new Date(2026, 7, 27));
    assert.equal(resolverIntervaloFinanceiro("todos", null, AGORA).inicio, null);
    assert.equal(contarDiasAbertosNoIntervalo(resolverIntervaloFinanceiro("todos", null, AGORA), [1]), null);
  });

  it("lista anos com dados e sempre o ano atual", () => {
    assert.deepEqual(anosDisponiveis(["2024-05-01 10:00:00", "2026-01-01T12:00:00Z"], AGORA), [2026, 2024]);
  });
});

describe("meu balanco", () => {
  const vendas = [
    venda(1, "2026-09-10T12:00:00Z", { agendamentos: { data_agendamento: "2026-09-10 09:00:00", profissional_id: 7 } }),
    venda(2, "2026-09-10T12:00:00Z", { agendamentos: [{ data_agendamento: "2026-09-10 10:00:00", profissional_id: 8 }] }),
    venda(3, "2026-09-10T12:00:00Z", { agendamentos: null }),
  ];

  it("geral mostra tudo", () => {
    assert.equal(filtrarVendasPorVisao(vendas, "geral").length, 3);
  });

  it("por profissional filtra vendas e agendamentos", () => {
    assert.deepEqual(filtrarVendasPorVisao(vendas, 7).map((v) => v.id), [1]);
    const agendamentos = [
      { data_agendamento: "x", profissional_id: 7, status: "finalizado" },
      { data_agendamento: "x", profissional_id: null, status: "finalizado" },
    ];
    assert.equal(filtrarAgendamentosPorVisao(agendamentos, 7).length, 1);
    assert.equal(filtrarAgendamentosPorVisao(agendamentos, 99).length, 0);
  });
});

describe("upsell produto", () => {
  it("22 de 100 vendas com produto = 22%", () => {
    const vendas = Array.from({ length: 100 }, (_, i) =>
      venda(i + 1, "2026-09-10T12:00:00Z", { venda_itens: i < 22 ? [{ quantidade: 1 }] : [] }),
    );
    assert.deepEqual(calcularUpsellProduto(vendas), { parte: 22, percentual: 22, total: 100 });
  });

  it("conta a venda, nao a quantidade de produtos", () => {
    const vendas = [
      venda(1, "x", { venda_itens: [{ quantidade: 3 }, { quantidade: 2 }] }),
      venda(2, "x", { venda_itens: [{ quantidade: 0 }] }),
      venda(3, "x", { venda_itens: null }),
      venda(4, "x"),
    ];
    assert.deepEqual(calcularUpsellProduto(vendas), { parte: 1, percentual: 25, total: 4 });
  });

  it("sem vendas retorna percentual nulo", () => {
    assert.equal(calcularUpsellProduto([]).percentual, null);
  });
});

describe("pendencias", () => {
  it("considera so atendimentos ja encerrados e nao finalizados", () => {
    const agendamentos = [
      { data_agendamento: "2026-09-24 10:00:00", status: "finalizado" },
      { data_agendamento: "2026-09-24 11:00:00", status: "confirmado" }, // pendente
      { data_agendamento: "2026-09-24 12:00:00", status: "cancelado" }, // ignorado
      { data_agendamento: "2026-09-25 14:45:00", status: "confirmado", servicos: { duracao: 30 } }, // em andamento
      { data_agendamento: "2026-09-25 14:00:00", status: "confirmado", servicos: [{ duracao: 60 }] }, // terminou 15:00
      { data_agendamento: "2026-09-26 09:00:00", status: "confirmado" }, // futuro
    ];
    assert.deepEqual(calcularPendencias(agendamentos, AGORA), { parte: 2, percentual: 67, total: 3 });
  });

  it("sem atendimentos realizados retorna percentual nulo", () => {
    assert.equal(calcularPendencias([{ data_agendamento: "2026-09-30 09:00:00", status: "confirmado" }], AGORA).percentual, null);
  });
});

describe("ver mais por forma de pagamento", () => {
  const vendas = [
    venda(1, "2026-09-10T12:00:00Z", {
      agendamento_id: 11,
      agendamentos: {
        clientes: { nome: "Cliente A" },
        data_agendamento: "2026-09-10 09:00:00",
        profissionais: [{ nome: "Pro A" }],
        servicos: { nome: "Corte" },
      },
      forma_pagamento: "Pix",
      total: 45,
    }),
    venda(2, "2026-09-12T12:00:00Z", { forma_pagamento: " Pix ", total: 30 }),
    venda(3, "2026-09-11T12:00:00Z", { forma_pagamento: null }),
    venda(4, "2026-09-11T12:00:00Z", { forma_pagamento: "Débito" }),
  ];

  it("retorna data, cliente, profissional, valor, forma e ids, mais recente primeiro", () => {
    const linhas = detalharFormaPagamento(vendas, "Pix");
    assert.deepEqual(linhas.map((l) => l.id), [2, 1]);
    assert.deepEqual(linhas[1], {
      agendamentoId: 11,
      cliente: "Cliente A",
      data: "2026-09-10T12:00:00Z",
      formaPagamento: "Pix",
      id: 1,
      profissional: "Pro A",
      servico: "Corte",
      valor: 45,
    });
    assert.equal(linhas[0].cliente, "-");
  });

  it("agrupa vendas sem forma em 'Nao informado'", () => {
    assert.deepEqual(detalharFormaPagamento(vendas, FORMA_PAGAMENTO_NAO_INFORMADA).map((l) => l.id), [3]);
    assert.deepEqual(detalharFormaPagamento(vendas, "Débito").map((l) => l.id), [4]);
  });
});
