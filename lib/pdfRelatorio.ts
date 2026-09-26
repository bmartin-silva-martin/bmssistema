// Gerador de PDF minimo (texto + tabelas simples) sem dependencias externas.
// Usa as fontes padrao Helvetica do PDF com WinAnsiEncoding, suficiente para acentos do portugues.
// So recebe dados ja carregados pelo painel (RLS por empresa), nada e buscado aqui.
import type { RelatorioFinanceiro } from "./financeiro";

type LinhaPdf = {
  celulas: string[];
  espacoAntes?: number;
  larguras?: number[];
  negrito?: boolean;
  tamanho?: number;
};

const PAGINA_LARGURA = 595.28;
const PAGINA_ALTURA = 841.89;
const MARGEM = 40;
const AREA_UTIL = PAGINA_LARGURA - MARGEM * 2;

const WIN_ANSI_EXTRA: Record<string, number> = {
  "€": 0x80,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
};

function paraWinAnsi(texto: string) {
  let saida = "";
  for (const caractere of texto.normalize("NFC")) {
    const codigo = caractere.charCodeAt(0);
    if (WIN_ANSI_EXTRA[caractere]) saida += String.fromCharCode(WIN_ANSI_EXTRA[caractere]);
    else if ((codigo >= 32 && codigo < 0x7f) || (codigo >= 0xa0 && codigo <= 0xff)) saida += caractere;
    else saida += "?";
  }
  return saida;
}

function escaparTextoPdf(texto: string) {
  return texto.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function truncar(texto: string, largura: number, tamanho: number) {
  // Helvetica tem largura media ~0,5em; aproximacao suficiente para cortar celulas de tabela.
  const maxCaracteres = Math.max(1, Math.floor(largura / (tamanho * 0.52)));
  return texto.length > maxCaracteres ? `${texto.slice(0, Math.max(1, maxCaracteres - 1))}…` : texto;
}

export function gerarPdf(linhas: LinhaPdf[]) {
  const paginas: string[] = [];
  let conteudo = "";
  let y = PAGINA_ALTURA - MARGEM;

  linhas.forEach((linha) => {
    const tamanho = linha.tamanho ?? 10;
    const alturaLinha = tamanho * 1.45 + (linha.espacoAntes ?? 0);

    if (y - alturaLinha < MARGEM + 20) {
      paginas.push(conteudo);
      conteudo = "";
      y = PAGINA_ALTURA - MARGEM;
    }

    y -= alturaLinha;
    let x = MARGEM;
    const fonte = linha.negrito ? "F2" : "F1";

    linha.celulas.forEach((celula, index) => {
      const largura = linha.larguras?.[index] ?? AREA_UTIL;
      const texto = escaparTextoPdf(paraWinAnsi(truncar(celula, largura, tamanho)));
      conteudo += `BT /${fonte} ${tamanho} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${texto}) Tj ET\n`;
      x += largura;
    });
  });
  paginas.push(conteudo);

  const objetos: string[] = [];
  const idsPaginas: number[] = [];
  // 1 catalogo, 2 arvore de paginas, 3 Helvetica, 4 Helvetica-Bold, depois pares pagina/conteudo.
  objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objetos[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objetos[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  paginas.forEach((stream, index) => {
    const rodape = `BT /F1 8 Tf ${MARGEM} ${MARGEM - 10} Td (Pagina ${index + 1} de ${paginas.length}) Tj ET\n`;
    const completo = stream + rodape;
    const idPagina = 5 + index * 2;
    const idConteudo = idPagina + 1;
    idsPaginas.push(idPagina);
    objetos[idPagina] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGINA_LARGURA} ${PAGINA_ALTURA}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idConteudo} 0 R >>`;
    objetos[idConteudo] = `<< /Length ${completo.length} >>\nstream\n${completo}endstream`;
  });
  objetos[2] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(" ")}] /Count ${idsPaginas.length} >>`;

  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objetos.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
  }
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;

  // Todo o documento ja esta em bytes 0-255 (WinAnsi), entao cada caractere vira exatamente um byte.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

const moeda = new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" });

function formatarData(data: Date) {
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getFullYear()}`;
}

function formatarDataHora(data: Date) {
  return `${formatarData(data)} ${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

function formatarIndicador(indicador: RelatorioFinanceiro["upsellProduto"], rotulo: string) {
  if (indicador.percentual === null) return "n/d (sem dados no periodo)";
  return `${indicador.percentual}% (${indicador.parte} de ${indicador.total} ${rotulo})`;
}

function secao(titulo: string): LinhaPdf {
  return { celulas: [titulo], espacoAntes: 10, negrito: true, tamanho: 12 };
}

export function montarLinhasRelatorioFinanceiro(relatorio: RelatorioFinanceiro): LinhaPdf[] {
  const larguraRotulo = [170, AREA_UTIL - 170];
  const linhas: LinhaPdf[] = [
    { celulas: ["RELATÓRIO FINANCEIRO"], negrito: true, tamanho: 16 },
    { celulas: [`Empresa: ${relatorio.empresa}`], espacoAntes: 4 },
    { celulas: [`Período: ${relatorio.periodo}`] },
    { celulas: [`Visão: ${relatorio.visao}`] },
    { celulas: [`Gerado em: ${formatarDataHora(relatorio.geradoEm)}`], tamanho: 8 },

    secao("Indicadores"),
    { celulas: ["Receita", moeda.format(relatorio.receita)], larguras: larguraRotulo },
    { celulas: ["Ticket médio", moeda.format(relatorio.ticketMedio)], larguras: larguraRotulo },
    {
      celulas: ["Taxa de ocupação", relatorio.taxaOcupacao === null ? "n/d (periodo sem limite)" : `${relatorio.taxaOcupacao}%`],
      larguras: larguraRotulo,
    },
    { celulas: ["Upsell Produto", formatarIndicador(relatorio.upsellProduto, "atendimentos")], larguras: larguraRotulo },
    { celulas: ["Pendências", formatarIndicador(relatorio.pendencias, "agendamentos realizados")], larguras: larguraRotulo },

    secao("Resumo por forma de pagamento"),
  ];

  const largurasFormas = [200, 80, 140, AREA_UTIL - 420];
  if (relatorio.formasPagamento.length === 0) {
    linhas.push({ celulas: ["Nenhuma venda no período."] });
  } else {
    linhas.push({ celulas: ["Forma", "Vendas", "Valor", "%"], larguras: largurasFormas, negrito: true, tamanho: 9 });
    relatorio.formasPagamento.forEach((forma) => {
      const percentual = relatorio.receita > 0 ? Math.round((forma.valor / relatorio.receita) * 100) : 0;
      linhas.push({
        celulas: [forma.nome, String(forma.total), moeda.format(forma.valor), `${percentual}%`],
        larguras: largurasFormas,
        tamanho: 9,
      });
    });
  }

  if (relatorio.profissional) {
    linhas.push(
      secao("Resumo do profissional"),
      { celulas: ["Profissional", relatorio.profissional.nome], larguras: larguraRotulo },
      { celulas: ["Atendimentos", String(relatorio.profissional.atendimentos)], larguras: larguraRotulo },
      { celulas: ["Receita", moeda.format(relatorio.profissional.receita)], larguras: larguraRotulo },
    );
  }

  linhas.push(secao("Detalhamento das vendas"));
  const largurasDetalhe = [62, 115, 105, 90, 68, AREA_UTIL - 440];
  if (relatorio.vendas.length === 0) {
    linhas.push({ celulas: ["Nenhuma venda no período."] });
  } else {
    linhas.push({
      celulas: ["Data", "Cliente", "Serviço", "Profissional", "Valor", "Pagamento"],
      larguras: largurasDetalhe,
      negrito: true,
      tamanho: 8,
    });
    relatorio.vendas.forEach((venda) => {
      linhas.push({
        celulas: [
          formatarData(new Date(venda.data)),
          venda.cliente,
          venda.servico,
          venda.profissional,
          moeda.format(venda.valor),
          venda.formaPagamento,
        ],
        larguras: largurasDetalhe,
        tamanho: 8,
      });
    });
  }

  return linhas;
}

export function gerarRelatorioFinanceiroPdf(relatorio: RelatorioFinanceiro) {
  return gerarPdf(montarLinhasRelatorioFinanceiro(relatorio));
}
