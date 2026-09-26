import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gerarRelatorioFinanceiroPdf } from "../lib/pdfRelatorio.ts";

function relatorio(extra = {}) {
  return {
    empresa: "Barbearia Teste",
    formasPagamento: [
      { nome: "Pix", total: 2, valor: 100 },
      { nome: "Nao informado", total: 1, valor: 50 },
    ],
    geradoEm: new Date(2026, 8, 25, 15, 0),
    pendencias: { parte: 1, percentual: 25, total: 4 },
    periodo: "Setembro/2026 (01/09/2026 a 30/09/2026)",
    profissional: null,
    receita: 150,
    taxaOcupacao: 40,
    ticketMedio: 50,
    upsellProduto: { parte: 1, percentual: 33, total: 3 },
    vendas: [
      {
        agendamentoId: 10,
        cliente: "João (teste)",
        data: "2026-09-10T12:00:00Z",
        formaPagamento: "Pix",
        id: 1,
        profissional: "Pro A",
        servico: "Corte",
        valor: 50,
      },
    ],
    visao: "Geral",
    ...extra,
  };
}

function comoTexto(bytes) {
  return Buffer.from(bytes).toString("latin1");
}

describe("PDF do relatorio financeiro", () => {
  it("gera um PDF valido com xref consistente", () => {
    const texto = comoTexto(gerarRelatorioFinanceiroPdf(relatorio()));
    assert.ok(texto.startsWith("%PDF-1.4"));
    assert.ok(texto.trimEnd().endsWith("%%EOF"));

    const inicioXref = Number(texto.match(/startxref\n(\d+)/)[1]);
    assert.ok(texto.slice(inicioXref).startsWith("xref"));
    const offsets = [...texto.slice(inicioXref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, index) => assert.ok(texto.slice(offset).startsWith(`${index + 1} 0 obj`)));
  });

  it("inclui periodo, indicadores, formas e detalhe; acentos em WinAnsi e parenteses escapados", () => {
    const texto = comoTexto(gerarRelatorioFinanceiroPdf(relatorio()));
    assert.ok(texto.includes("(RELAT\xd3RIO FINANCEIRO)"));
    assert.ok(texto.includes("Setembro/2026 \\(01/09/2026 a 30/09/2026\\)"));
    assert.ok(texto.includes("(Upsell Produto)"));
    assert.ok(texto.includes("(33% \\(1 de 3 atendimentos\\))"));
    assert.ok(texto.includes("(Pend\xeancias)"));
    assert.ok(texto.includes("(Pix)"));
    assert.ok(texto.includes("(Jo\xe3o \\(teste\\))"));
    assert.ok(!texto.includes("Resumo do profissional"));
  });

  it("inclui resumo do profissional quando o filtro esta ativo", () => {
    const texto = comoTexto(
      gerarRelatorioFinanceiroPdf(relatorio({ profissional: { atendimentos: 3, nome: "Pro A", receita: 150 }, visao: "Profissional: Pro A" })),
    );
    assert.ok(texto.includes("(Resumo do profissional)"));
    assert.ok(texto.includes("(Vis\xe3o: Profissional: Pro A)"));
  });

  it("quebra em varias paginas quando ha muitas vendas", () => {
    const vendas = Array.from({ length: 200 }, (_, i) => ({ ...relatorio().vendas[0], id: i + 1 }));
    const texto = comoTexto(gerarRelatorioFinanceiroPdf(relatorio({ vendas })));
    const paginas = Number(texto.match(/\/Type \/Pages .* \/Count (\d+)/)[1]);
    assert.ok(paginas > 1);
    assert.ok(texto.includes(`(Pagina ${paginas} de ${paginas})`));
  });

  it("so contem as vendas recebidas (nenhum dado buscado alem do que o painel autorizou)", () => {
    const texto = comoTexto(gerarRelatorioFinanceiroPdf(relatorio({ vendas: [] })));
    assert.ok(!texto.includes("Jo\xe3o"));
    assert.ok(texto.includes("(Nenhuma venda no per\xedodo.)"));
  });
});
