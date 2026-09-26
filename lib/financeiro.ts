// Regras puras do Financeiro (sem React/Supabase) para poderem ser testadas com `npm test`.
// Todas as datas seguem o horario local do navegador, igual ao restante do painel.

type Relacao<T> = T | T[] | null | undefined;

export type PeriodoFinanceiro = "hoje" | "7" | "30" | "todos";

/** month: 1-12 */
export type FiltroMes = { month: number; year: number };

/** "geral" = empresa inteira; numero = id do profissional filtrado. */
export type VisaoBalanco = "geral" | number;

export type IntervaloFinanceiro = {
  descricao: string;
  dias: number | null;
  /** exclusivo; null = sem limite superior (comportamento original dos filtros relativos) */
  fim: Date | null;
  inicio: Date | null;
};

export type VendaFinanceira = {
  agendamento_id: number | null;
  created_at: string;
  forma_pagamento?: string | null;
  id: number;
  total: number | null;
  agendamentos?: Relacao<{
    data_agendamento: string;
    profissional_id?: number | null;
    clientes?: Relacao<{ nome: string }>;
    profissionais?: Relacao<{ nome: string }>;
    servicos?: Relacao<{ nome: string }>;
  }>;
  venda_itens?: { quantidade: number }[] | null;
};

export type AgendamentoFinanceiro = {
  data_agendamento: string;
  profissional_id?: number | null;
  status: string;
  servicos?: Relacao<{ duracao?: number | null }>;
};

export type IndicadorPercentual = {
  parte: number;
  percentual: number | null;
  total: number;
};

export type LinhaDetalheVenda = {
  agendamentoId: number | null;
  cliente: string;
  data: string;
  formaPagamento: string;
  id: number;
  profissional: string;
  servico: string;
  valor: number;
};

export type RelatorioFinanceiro = {
  empresa: string;
  formasPagamento: { nome: string; total: number; valor: number }[];
  geradoEm: Date;
  pendencias: IndicadorPercentual;
  periodo: string;
  profissional: { atendimentos: number; nome: string; receita: number } | null;
  receita: number;
  taxaOcupacao: number | null;
  ticketMedio: number;
  upsellProduto: IndicadorPercentual;
  vendas: LinhaDetalheVenda[];
  visao: string;
};

export const MESES_FILTRO = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const MESES_NOMES = [
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const FORMA_PAGAMENTO_NAO_INFORMADA = "Nao informado";
const DURACAO_PADRAO_MIN = 30;

function primeiraRelacao<T>(value: Relacao<T>): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export function formatarDataCurta(data: Date) {
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getFullYear()}`;
}

export function filtroMesValido(filtro: FiltroMes | null | undefined): filtro is FiltroMes {
  return (
    !!filtro &&
    Number.isInteger(filtro.month) &&
    filtro.month >= 1 &&
    filtro.month <= 12 &&
    Number.isInteger(filtro.year) &&
    filtro.year >= 2000 &&
    filtro.year <= 2100
  );
}

/** Filtro mensal tem prioridade; sem ele, mantem os filtros relativos Hoje/7/30/Tudo. */
export function resolverIntervaloFinanceiro(
  periodo: PeriodoFinanceiro,
  mes?: FiltroMes | null,
  agora: Date = new Date(),
): IntervaloFinanceiro {
  if (filtroMesValido(mes)) {
    const inicio = new Date(mes.year, mes.month - 1, 1);
    const fim = new Date(mes.year, mes.month, 1);
    const dias = new Date(mes.year, mes.month, 0).getDate();
    const ultimoDia = new Date(mes.year, mes.month - 1, dias);
    return {
      descricao: `${MESES_NOMES[mes.month - 1]}/${mes.year} (${formatarDataCurta(inicio)} a ${formatarDataCurta(ultimoDia)})`,
      dias,
      fim,
      inicio,
    };
  }

  if (periodo === "todos") return { descricao: "Todo o periodo", dias: null, fim: null, inicio: null };

  const dias = periodo === "hoje" ? 1 : Number(periodo);
  const inicio = new Date(agora);
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - (dias - 1));

  return {
    descricao:
      periodo === "hoje"
        ? `Hoje (${formatarDataCurta(agora)})`
        : `Ultimos ${dias} dias (${formatarDataCurta(inicio)} a ${formatarDataCurta(agora)})`,
    dias,
    fim: null,
    inicio,
  };
}

export function estaNoIntervalo(dataIso: string, intervalo: IntervaloFinanceiro) {
  const data = new Date(dataIso);
  if (intervalo.inicio && data < intervalo.inicio) return false;
  if (intervalo.fim && data >= intervalo.fim) return false;
  return true;
}

export function filtrarVendasPorIntervalo<T extends { created_at: string }>(vendas: T[], intervalo: IntervaloFinanceiro) {
  return vendas.filter((venda) => estaNoIntervalo(venda.created_at, intervalo));
}

export function filtrarAgendamentosPorIntervalo<T extends { data_agendamento: string }>(
  agendamentos: T[],
  intervalo: IntervaloFinanceiro,
) {
  return agendamentos.filter((agendamento) => estaNoIntervalo(agendamento.data_agendamento, intervalo));
}

export function contarDiasAbertosNoIntervalo(intervalo: IntervaloFinanceiro, diasAtendimento: number[]) {
  if (!intervalo.inicio || !intervalo.dias) return null;

  const diasSet = new Set(diasAtendimento);
  let abertos = 0;

  for (let i = 0; i < intervalo.dias; i++) {
    const data = new Date(intervalo.inicio);
    data.setDate(data.getDate() + i);
    if (diasSet.has(data.getDay())) abertos++;
  }

  return abertos;
}

export function anosDisponiveis(datasIso: string[], agora: Date = new Date()) {
  const anos = new Set<number>([agora.getFullYear()]);
  datasIso.forEach((dataIso) => {
    const ano = new Date(dataIso).getFullYear();
    if (Number.isFinite(ano)) anos.add(ano);
  });
  return Array.from(anos).sort((a, b) => b - a);
}

export function profissionalDaVenda(venda: VendaFinanceira) {
  return primeiraRelacao(venda.agendamentos)?.profissional_id ?? null;
}

export function filtrarVendasPorVisao<T extends VendaFinanceira>(vendas: T[], visao: VisaoBalanco) {
  if (visao === "geral") return vendas;
  return vendas.filter((venda) => profissionalDaVenda(venda) === visao);
}

export function filtrarAgendamentosPorVisao<T extends { profissional_id?: number | null }>(agendamentos: T[], visao: VisaoBalanco) {
  if (visao === "geral") return agendamentos;
  return agendamentos.filter((agendamento) => agendamento.profissional_id === visao);
}

function indicador(parte: number, total: number): IndicadorPercentual {
  return { parte, percentual: total > 0 ? Math.round((parte / total) * 100) : null, total };
}

/**
 * Upsell Produto: % das vendas (cada venda = um atendimento finalizado) com pelo menos 1 produto.
 * Conta a venda, nao a quantidade de produtos.
 */
export function calcularUpsellProduto(vendas: VendaFinanceira[]) {
  const comProduto = vendas.filter((venda) => venda.venda_itens?.some((item) => item.quantidade > 0)).length;
  return indicador(comProduto, vendas.length);
}

/**
 * Pendencias: agendamentos cujo horario ja terminou e que continuam abertos (nem finalizados, nem cancelados),
 * ou seja, sem venda lancada. O sistema nao diferencia "cliente faltou" de "atendeu e nao fechou":
 * ambos aparecem aqui ate o dono finalizar ou cancelar.
 */
export function calcularPendencias(agendamentos: AgendamentoFinanceiro[], agora: Date = new Date()) {
  const realizados = agendamentos.filter((agendamento) => {
    if (agendamento.status.toLowerCase() === "cancelado") return false;
    const duracao = primeiraRelacao(agendamento.servicos)?.duracao;
    const fim = new Date(agendamento.data_agendamento).getTime() + (duracao && duracao > 0 ? duracao : DURACAO_PADRAO_MIN) * 60000;
    return fim <= agora.getTime();
  });
  const pendentes = realizados.filter((agendamento) => agendamento.status.toLowerCase() !== "finalizado").length;
  return indicador(pendentes, realizados.length);
}

// TODO(performance): "receita real / receita potencial da agenda" nao foi implementada.
// Validado com dados reais em 2026-09-25: venda.total = preco do servico + produtos no momento da finalizacao,
// entao receita real / potencial dos horarios finalizados = 1,00 + fatia de produtos (sempre >= 1).
// Incluindo horarios ocupados nao finalizados, o indice vira apenas o complemento de Pendencias.
// Falta um dado independente (ex.: desconto/preco cobrado vs. tabela, ou capacidade por profissional em
// profissional_horarios preenchida) para a metrica ter significado proprio.

export function nomeFormaPagamento(venda: Pick<VendaFinanceira, "forma_pagamento">) {
  return venda.forma_pagamento?.trim() || FORMA_PAGAMENTO_NAO_INFORMADA;
}

// Mesmos rotulos do fluxo legado e dos valores ja gravados no banco ("Pix", "Débito").
// vendas.forma_pagamento e text sem constraint, entao a validacao fica aqui.
export const FORMAS_PAGAMENTO = ["Pix", "Crédito", "Débito", "Dinheiro", "Assinatura"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const MENSAGEM_FORMA_PAGAMENTO_OBRIGATORIA = "Selecione a forma de pagamento para finalizar o atendimento.";

export function formaPagamentoValida(valor: string | null | undefined): valor is FormaPagamento {
  return FORMAS_PAGAMENTO.includes(valor as FormaPagamento);
}

/** Payload de vendas na finalizacao; so difere do anterior por exigir e gravar forma_pagamento. */
export function montarVendaFinalizacao(dados: {
  agendamentoId: number;
  empresaId: number;
  formaPagamento: string | null | undefined;
  total: number;
}) {
  if (!formaPagamentoValida(dados.formaPagamento)) {
    return { erro: MENSAGEM_FORMA_PAGAMENTO_OBRIGATORIA, ok: false as const };
  }

  return {
    ok: true as const,
    venda: {
      agendamento_id: dados.agendamentoId,
      empresa_id: dados.empresaId,
      forma_pagamento: dados.formaPagamento,
      total: dados.total,
    },
  };
}

export function resumirFormasPagamento(vendas: Pick<VendaFinanceira, "forma_pagamento" | "total">[]) {
  const totais = new Map<string, { total: number; valor: number }>();

  vendas.forEach((venda) => {
    const forma = nomeFormaPagamento(venda);
    const atual = totais.get(forma) || { total: 0, valor: 0 };
    totais.set(forma, { total: atual.total + 1, valor: atual.valor + (venda.total || 0) });
  });

  return Array.from(totais.entries())
    .map(([nome, dados]) => ({ nome, total: dados.total, valor: dados.valor }))
    .sort((a, b) => b.valor - a.valor);
}

export function listarDetalhesVendas(vendas: VendaFinanceira[]): LinhaDetalheVenda[] {
  return vendas
    .map((venda) => {
      const agendamento = primeiraRelacao(venda.agendamentos);
      return {
        agendamentoId: venda.agendamento_id,
        cliente: primeiraRelacao(agendamento?.clientes)?.nome || "-",
        data: venda.created_at,
        formaPagamento: nomeFormaPagamento(venda),
        id: venda.id,
        profissional: primeiraRelacao(agendamento?.profissionais)?.nome || "-",
        servico: primeiraRelacao(agendamento?.servicos)?.nome || "-",
        valor: venda.total || 0,
      };
    })
    .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
}

/** "Ver mais" de uma forma de pagamento, reaproveitando as vendas ja carregadas e filtradas. */
export function detalharFormaPagamento(vendas: VendaFinanceira[], forma: string) {
  return listarDetalhesVendas(vendas).filter((linha) => linha.formaPagamento === forma);
}
