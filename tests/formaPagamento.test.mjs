import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detalharFormaPagamento,
  FORMA_PAGAMENTO_NAO_INFORMADA,
  FORMAS_PAGAMENTO,
  formaPagamentoValida,
  MENSAGEM_FORMA_PAGAMENTO_OBRIGATORIA,
  montarVendaFinalizacao,
  resumirFormasPagamento,
} from "../lib/financeiro.ts";
import { gerarRelatorioFinanceiroPdf } from "../lib/pdfRelatorio.ts";

const BASE = { agendamentoId: 42, empresaId: 2, total: 95 };

// Simula a linha que o Supabase devolveria depois do insert + select de vendas do painel.
function persistir(venda, id) {
  return { ...venda, agendamentos: null, created_at: "2026-09-25T15:00:00Z", id, venda_itens: [] };
}

describe("finalizacao com forma de pagamento", () => {
  it("aceita somente as formas conhecidas (compativeis com os valores ja gravados)", () => {
    assert.deepEqual([...FORMAS_PAGAMENTO], ["Pix", "Crédito", "Débito", "Dinheiro", "Assinatura"]);
    FORMAS_PAGAMENTO.forEach((forma) => assert.ok(formaPagamentoValida(forma)));
    ["", null, undefined, "pix", "PIX", "Nao informado", "Boleto"].forEach((forma) =>
      assert.equal(formaPagamentoValida(forma), false, String(forma)),
    );
  });

  it("forma valida monta o payload com forma_pagamento sem mexer em total", () => {
    const resultado = montarVendaFinalizacao({ ...BASE, formaPagamento: "Pix" });
    assert.deepEqual(resultado, {
      ok: true,
      venda: { agendamento_id: 42, empresa_id: 2, forma_pagamento: "Pix", total: 95 },
    });
  });

  it("bloqueia sem forma e nunca cai em 'Nao informado' automaticamente", () => {
    for (const formaPagamento of ["", null, undefined, FORMA_PAGAMENTO_NAO_INFORMADA]) {
      const resultado = montarVendaFinalizacao({ ...BASE, formaPagamento });
      assert.deepEqual(resultado, { erro: MENSAGEM_FORMA_PAGAMENTO_OBRIGATORIA, ok: false });
      assert.equal("venda" in resultado, false);
    }
  });
});

describe("venda nova no financeiro", () => {
  const nova = montarVendaFinalizacao({ ...BASE, formaPagamento: "Dinheiro" });
  const vendas = [
    persistir(nova.venda, 100),
    persistir({ agendamento_id: 1, empresa_id: 2, forma_pagamento: null, total: 40 }, 1), // historico NULL
    persistir({ agendamento_id: 2, empresa_id: 2, forma_pagamento: "Pix", total: 60 }, 2),
  ];

  it("persiste forma_pagamento na linha da venda", () => {
    assert.equal(vendas[0].forma_pagamento, "Dinheiro");
  });

  it("resumo por forma de pagamento reconhece a nova venda e mantem NULL como 'Nao informado'", () => {
    assert.deepEqual(resumirFormasPagamento(vendas), [
      { nome: "Dinheiro", total: 1, valor: 95 },
      { nome: "Pix", total: 1, valor: 60 },
      { nome: FORMA_PAGAMENTO_NAO_INFORMADA, total: 1, valor: 40 },
    ]);
  });

  it("'Ver mais' reconhece a nova venda e o historico NULL", () => {
    assert.deepEqual(detalharFormaPagamento(vendas, "Dinheiro").map((linha) => [linha.id, linha.agendamentoId, linha.valor]), [[100, 42, 95]]);
    assert.deepEqual(detalharFormaPagamento(vendas, FORMA_PAGAMENTO_NAO_INFORMADA).map((linha) => linha.id), [1]);
  });

  it("PDF reconhece a nova forma de pagamento", () => {
    const pdf = Buffer.from(
      gerarRelatorioFinanceiroPdf({
        empresa: "Teste",
        formasPagamento: resumirFormasPagamento(vendas),
        geradoEm: new Date(2026, 8, 25),
        pendencias: { parte: 0, percentual: null, total: 0 },
        periodo: "Hoje",
        profissional: null,
        receita: 195,
        taxaOcupacao: null,
        ticketMedio: 65,
        upsellProduto: { parte: 0, percentual: 0, total: 3 },
        vendas: detalharFormaPagamento(vendas, "Dinheiro"),
        visao: "Geral",
      }),
    ).toString("latin1");
    assert.ok(pdf.includes("(Dinheiro)"));
    assert.ok(pdf.includes("(Nao informado)"));
  });
});
