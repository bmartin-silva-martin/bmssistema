"use client";

import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
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
  listarDetalhesVendas,
  FORMAS_PAGAMENTO,
  MESES_FILTRO,
  montarVendaFinalizacao,
  resolverIntervaloFinanceiro,
  resumirFormasPagamento,
  type FiltroMes,
  type IntervaloFinanceiro,
  type PeriodoFinanceiro,
  type VisaoBalanco,
} from "@/lib/financeiro";
import { gerarRelatorioFinanceiroPdf } from "@/lib/pdfRelatorio";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const EMPRESA_ID_LEGADO = 1;

type EmpresaFeatures = {
  cor_primaria?: string | null;
  cor_secundaria?: string | null;
  logo_url?: string | null;
  [key: string]: unknown;
};

type Empresa = {
  id: number;
  nome: string;
  plano: string | null;
  ativo: boolean | null;
  dias_atendimento?: number[] | null;
  horarios_atendimento?: string[] | null;
  licenca_expires_at?: string | null;
  licenca_grace_days?: number | null;
  licenca_install_id?: string | null;
  nome_responsavel?: string | null;
  owner_user_id?: string | null;
  slug?: string | null;
  features?: EmpresaFeatures | null;
};

type Servico = {
  id: number;
  nome: string;
  preco: number;
  duracao: number | null;
  precos_por_dia?: Record<string, number> | null;
  foto_url?: string | null;
};

type Produto = {
  comissao_percentual?: number | null;
  foto_url?: string | null;
  id: number;
  nome: string;
  preco: number | null;
  preco_custo: number | null;
  estoque: number | null;
};

type ClienteResumo = {
  data_nascimento?: string | null;
  id: number;
  nome: string;
  telefone: string | null;
};

type ServicoResumo = {
  duracao?: number | null;
  nome: string;
  preco: number | null;
  precos_por_dia?: Record<string, number> | null;
};

type Profissional = {
  ativo?: boolean | null;
  id: number;
  nome: string;
  foto_url?: string | null;
};

type ProfissionalResumo = {
  id: number;
  nome: string;
  foto_url?: string | null;
};

type Agendamento = {
  cliente_id: number | null;
  id: number;
  data_agendamento: string;
  lembrete_enviado_em?: string | null;
  lembrete_status?: string | null;
  profissional_id?: number | null;
  servico_id: number | null;
  status: string;
  clientes: ClienteResumo | ClienteResumo[] | null;
  servicos: ServicoResumo | ServicoResumo[] | null;
  profissionais?: ProfissionalResumo | ProfissionalResumo[] | null;
};

type VendaItem = {
  produto_id: number | null;
  quantidade: number;
  valor_unitario: number | null;
  produtos: { nome: string } | { nome: string }[] | null;
};

type VendaAgendamento = {
  data_agendamento: string;
  profissional_id?: number | null;
  clientes?: { nome: string } | { nome: string }[] | null;
  profissionais?: { nome: string } | { nome: string }[] | null;
  servicos: ServicoResumo | ServicoResumo[] | null;
};

type Venda = {
  agendamento_id: number | null;
  created_at: string;
  forma_pagamento?: string | null;
  id: number;
  total: number | null;
  agendamentos: VendaAgendamento | VendaAgendamento[] | null;
  venda_itens: VendaItem[] | null;
};

type RankingItem = {
  nome: string;
  total: number;
};

type PaymentItem = RankingItem & {
  valor: number;
};

type AdminSection = "visao" | "agenda" | "servicos" | "produtos" | "financeiro" | "clientes" | "inteligencia" | "configuracoes";
type AbaClientes = "cadastro" | "historico" | "ranking";
type DiaPainel = {
  dia: string;
  iso: string;
  labelCompleto: string;
  semana: string;
};

const diasCurtos = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
const DIAS_SEMANA_COMPLETOS = [
  { label: "Segunda-feira", dow: 1 },
  { label: "Terca-feira", dow: 2 },
  { label: "Quarta-feira", dow: 3 },
  { label: "Quinta-feira", dow: 4 },
  { label: "Sexta-feira", dow: 5 },
  { label: "Sabado", dow: 6 },
  { label: "Domingo", dow: 0 },
];
const mesesCurtos = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS_ATENDIMENTO_PADRAO = [1, 2, 3, 4, 5, 6];
const DURACOES_SERVICO_OPCOES = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120];
const DONO_STORAGE_KEY = "bms_nome_dono";
const EMPRESA_SELECT =
  "id,nome,plano,ativo,dias_atendimento,horarios_atendimento,nome_responsavel,slug,owner_user_id,licenca_install_id,licenca_expires_at,licenca_grace_days,features";
const HORARIOS_ATENDIMENTO_PADRAO = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "13:30",
  "13:45",
  "14:00",
  "14:15",
  "14:30",
  "14:45",
  "15:00",
  "16:00",
  "16:15",
  "16:30",
  "17:00",
];

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] || null : value;
}

function montarDiasDoPainel(offsetSemanas = 0) {
  const hoje = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + index + offsetSemanas * 7);

    return {
      dia: String(data.getDate()).padStart(2, "0"),
      iso: data.toISOString().slice(0, 10),
      labelCompleto: `${String(data.getDate()).padStart(2, "0")} ${mesesCurtos[data.getMonth()]} ${data.getFullYear()}`,
      semana: diasCurtos[data.getDay()],
    };
  });
}

function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

const AGENDA_PX_POR_MINUTO = 1.6;
const AGENDA_CARD_MIN_ALTURA = 58;
const AGENDA_DURACAO_PADRAO_MIN = 30;

function horaParaMinutos(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutosDoAgendamento(dataIso: string) {
  const data = new Date(dataIso);
  return data.getHours() * 60 + data.getMinutes();
}

function minutosAgora() {
  const agora = new Date();
  return agora.getHours() * 60 + agora.getMinutes();
}

function scrollParaPainelEdicao(id: string) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function formatarHoraMinutos(minutos: number) {
  const h = String(Math.floor(minutos / 60)).padStart(2, "0");
  const m = String(minutos % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function calcularJanelaHorario(horarios?: string[] | null) {
  const lista = horarios && horarios.length ? horarios : HORARIOS_ATENDIMENTO_PADRAO;
  const minutosLista = lista.map(horaParaMinutos);
  const inicio = Math.floor(Math.min(...minutosLista) / 60) * 60;
  const fim = Math.ceil(Math.max(...minutosLista, inicio + 60) / 60) * 60 + 60;
  return { inicio, fim };
}

type ItemTimelinePosicionado = {
  agendamento: Agendamento;
  inicioMin: number;
  duracaoMin: number;
  coluna: number;
  totalColunas: number;
};

function posicionarItensTimeline(agendamentos: Agendamento[]): ItemTimelinePosicionado[] {
  const itens = agendamentos
    .map((agendamento) => {
      const servico = firstRelation(agendamento.servicos);
      const inicioMin = minutosDoAgendamento(agendamento.data_agendamento);
      const duracaoMin = servico?.duracao && servico.duracao > 0 ? servico.duracao : AGENDA_DURACAO_PADRAO_MIN;
      return { agendamento, inicioMin, duracaoMin, fimMin: inicioMin + duracaoMin };
    })
    .sort((a, b) => a.inicioMin - b.inicioMin);

  const posicionados: ItemTimelinePosicionado[] = [];
  let cluster: typeof itens = [];
  let clusterFim = -1;

  const fecharCluster = () => {
    if (cluster.length === 0) return;
    const colunas: number[] = [];
    const atribuicoes = cluster.map((item) => {
      let coluna = colunas.findIndex((fimColuna) => fimColuna <= item.inicioMin);
      if (coluna === -1) {
        coluna = colunas.length;
        colunas.push(item.fimMin);
      } else {
        colunas[coluna] = item.fimMin;
      }
      return { ...item, coluna };
    });
    const totalColunas = colunas.length;
    atribuicoes.forEach((item) => {
      posicionados.push({
        agendamento: item.agendamento,
        inicioMin: item.inicioMin,
        duracaoMin: item.duracaoMin,
        coluna: item.coluna,
        totalColunas,
      });
    });
    cluster = [];
    clusterFim = -1;
  };

  itens.forEach((item) => {
    if (cluster.length > 0 && item.inicioMin >= clusterFim) fecharCluster();
    cluster.push(item);
    clusterFim = Math.max(clusterFim, item.fimMin);
  });
  fecharCluster();
  return posicionados;
}

function normalizarTelefoneBrasil(value = "") {
  let digits = value.replace(/\D/g, "");

  while (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }

  return digits;
}

function formatarErroSupabase(errorMessage: string) {
  if (errorMessage.includes("row-level security policy")) {
    return "Sem permissao no Supabase. Rode o SQL de policies para liberar esta acao.";
  }

  return errorMessage;
}

function licencaExpirada(empresa: Empresa | null) {
  if (!empresa?.licenca_expires_at) return false;

  return new Date(empresa.licenca_expires_at).getTime() < Date.now();
}

function diasRestantesLicenca(empresa: Empresa | null) {
  if (!empresa?.licenca_expires_at) return null;

  const diffMs = new Date(empresa.licenca_expires_at).getTime() - Date.now();

  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export default function AdminDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSenha, setLoginSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loginCarregando, setLoginCarregando] = useState(false);
  const [licencaToken, setLicencaToken] = useState("");
  const [licencaCarregando, setLicencaCarregando] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>("agenda");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [profissionais, setProfissionais] = useState<Profissional[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [produtoAviso, setProdutoAviso] = useState("");
  const [financeiroAviso, setFinanceiroAviso] = useState("");
  const [servicoForm, setServicoForm] = useState({ duracao: "30", foto_url: "", nome: "", preco: "" });
  const [produtoForm, setProdutoForm] = useState({ comissao: "", custo: "", estoque: "0", foto_url: "", nome: "", preco: "" });
  const [abaClientes, setAbaClientes] = useState<AbaClientes>("cadastro");
  const [periodoFinanceiro, setPeriodoFinanceiro] = useState<PeriodoFinanceiro>("hoje");
  // Quando preenchido, o filtro mensal substitui Hoje/7/30/Tudo.
  const [mesFinanceiro, setMesFinanceiro] = useState<FiltroMes | null>(null);
  const [visaoBalanco, setVisaoBalanco] = useState<VisaoBalanco>("geral");
  const [formaPagamentoDetalhe, setFormaPagamentoDetalhe] = useState<string | null>(null);
  const [atendimentoAberto, setAtendimentoAberto] = useState<Agendamento | null>(null);
  const [itensVenda, setItensVenda] = useState<Record<number, string>>({});
  const [formaPagamentoVenda, setFormaPagamentoVenda] = useState("");
  const [avisoFinalizacao, setAvisoFinalizacao] = useState("");
  const [salvandoServico, setSalvandoServico] = useState(false);
  const [salvandoProduto, setSalvandoProduto] = useState(false);
  const [finalizandoVenda, setFinalizandoVenda] = useState(false);
  const [salvandoConfiguracao, setSalvandoConfiguracao] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [buscaHistorico, setBuscaHistorico] = useState("");
  const [nomeDono, setNomeDono] = useState(() => {
    if (typeof window === "undefined") return "";

    return window.localStorage.getItem(DONO_STORAGE_KEY) || "";
  });
  const [configDias, setConfigDias] = useState<number[]>(DIAS_ATENDIMENTO_PADRAO);
  const [configHorarios, setConfigHorarios] = useState<string[]>(HORARIOS_ATENDIMENTO_PADRAO);
  const [novoHorario, setNovoHorario] = useState("");
  const [addProdutoOpen, setAddProdutoOpen] = useState(false);
  const [periodoInteligencia, setPeriodoInteligencia] = useState<"7" | "30" | "custom">("30");
  const [inteligenciaDataInicio, setInteligenciaDataInicio] = useState("");
  const [inteligenciaDataFim, setInteligenciaDataFim] = useState("");
  const [filtroProfissionalId, setFiltroProfissionalId] = useState<number | "todos">("todos");
  const [diaAgendaSelecionado, setDiaAgendaSelecionado] = useState(dataLocalISO());
  const [agendaWeekOffset, setAgendaWeekOffset] = useState(0);
  const [novoAgendamentoAberto, setNovoAgendamentoAberto] = useState(false);
  const [novoAgendamentoForm, setNovoAgendamentoForm] = useState({
    clienteNome: "",
    clienteTelefone: "",
    data: dataLocalISO(),
    horario: "",
    profissionalId: "",
    servicoId: "",
  });
  const [salvandoNovoAgendamento, setSalvandoNovoAgendamento] = useState(false);

  const empresaIdAtual = empresa?.id || EMPRESA_ID_LEGADO;
  const empresaSlugAtual = empresa?.slug?.trim();
  const linkPublico =
    typeof window === "undefined"
      ? `/agendamentos${empresaSlugAtual ? `?empresa=${empresaSlugAtual}` : ""}`
      : `${window.location.origin}/agendamentos${empresaSlugAtual ? `?empresa=${empresaSlugAtual}` : ""}`;
  const diasAgendaPainel = useMemo(() => montarDiasDoPainel(agendaWeekOffset), [agendaWeekOffset]);

  const navegarSemanaAgenda = (direcao: -1 | 1) => {
    const novoOffset = agendaWeekOffset + direcao;
    setAgendaWeekOffset(novoOffset);
    setDiaAgendaSelecionado(montarDiasDoPainel(novoOffset)[0].iso);
  };

  const ranking = useMemo(() => {
    const totais = new Map<string, number>();

    agendamentos.forEach((agendamento) => {
      const servico = firstRelation(agendamento.servicos);
      if (!servico?.nome) return;
      totais.set(servico.nome, (totais.get(servico.nome) || 0) + 1);
    });

    return Array.from(totais.entries())
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [agendamentos]);

  const agendamentosAtivos = useMemo(() => {
    return agendamentos.filter((agendamento) => {
      const status = agendamento.status.toLowerCase();
      return status !== "cancelado" && status !== "finalizado";
    });
  }, [agendamentos]);

  const diasComAgendamentoAgenda = useMemo(
    () => new Set(agendamentosAtivos.map((agendamento) => agendamento.data_agendamento.slice(0, 10))),
    [agendamentosAtivos],
  );

  const agendamentosDoDiaSelecionado = useMemo(
    () =>
      agendamentosAtivos
        .filter((agendamento) => agendamento.data_agendamento.slice(0, 10) === diaAgendaSelecionado)
        .sort((a, b) => new Date(a.data_agendamento).getTime() - new Date(b.data_agendamento).getTime()),
    [agendamentosAtivos, diaAgendaSelecionado],
  );

  const agendamentosDoDiaFiltrados = useMemo(() => {
    if (filtroProfissionalId === "todos") return agendamentosDoDiaSelecionado;
    return agendamentosDoDiaSelecionado.filter((agendamento) => agendamento.profissional_id === filtroProfissionalId);
  }, [agendamentosDoDiaSelecionado, filtroProfissionalId]);

  const historicoAgendamentos = useMemo(() => {
    return agendamentos
      .filter((agendamento) => agendamento.status.toLowerCase() === "finalizado")
      .sort((a, b) => new Date(b.data_agendamento).getTime() - new Date(a.data_agendamento).getTime());
  }, [agendamentos]);

  const historicoFiltrado = useMemo(() => {
    const termo = buscaHistorico.trim().toLowerCase();
    if (!termo) return historicoAgendamentos;

    return historicoAgendamentos.filter((agendamento) => {
      const cliente = firstRelation(agendamento.clientes);
      const servico = firstRelation(agendamento.servicos);
      const horario = new Date(agendamento.data_agendamento).toLocaleString("pt-BR").toLowerCase();

      return [cliente?.nome, cliente?.telefone, servico?.nome, horario]
        .filter(Boolean)
        .some((valor) => String(valor).toLowerCase().includes(termo));
    });
  }, [buscaHistorico, historicoAgendamentos]);

  const proximosAgendamentos = useMemo(() => {
    return [...agendamentosAtivos]
      .sort((a, b) => new Date(a.data_agendamento).getTime() - new Date(b.data_agendamento).getTime())
      .slice(0, 6);
  }, [agendamentosAtivos]);

  const lembretesDeHoje = useMemo(() => {
    const hojeIso = dataLocalISO();

    return agendamentosAtivos
      .filter((agendamento) => {
        return agendamento.data_agendamento.slice(0, 10) === hojeIso;
      })
      .sort((a, b) => new Date(a.data_agendamento).getTime() - new Date(b.data_agendamento).getTime());
  }, [agendamentosAtivos]);

  const intervaloFinanceiro = useMemo(
    () => resolverIntervaloFinanceiro(periodoFinanceiro, mesFinanceiro),
    [periodoFinanceiro, mesFinanceiro],
  );
  const agendamentosDaVisao = useMemo(() => filtrarAgendamentosPorVisao(agendamentos, visaoBalanco), [agendamentos, visaoBalanco]);
  const vendasFiltradas = useMemo(
    () => filtrarVendasPorVisao(filtrarVendasPorIntervalo(vendas, intervaloFinanceiro), visaoBalanco),
    [intervaloFinanceiro, vendas, visaoBalanco],
  );
  const resumoFinanceiro = useMemo(
    () =>
      calcularResumoFinanceiro(
        vendasFiltradas,
        agendamentosDaVisao,
        produtos,
        intervaloFinanceiro,
        empresa?.horarios_atendimento,
        empresa?.dias_atendimento,
      ),
    [agendamentosDaVisao, produtos, vendasFiltradas, intervaloFinanceiro, empresa],
  );
  const anosFinanceiro = useMemo(
    () => anosDisponiveis([...vendas.map((venda) => venda.created_at), ...agendamentos.map((agendamento) => agendamento.data_agendamento)]),
    [agendamentos, vendas],
  );
  // "Ver mais" por forma de pagamento: reaproveita as vendas ja carregadas e filtradas (periodo + visao).
  const detalheFormaPagamento = useMemo(
    () => (formaPagamentoDetalhe ? detalharFormaPagamento(vendasFiltradas, formaPagamentoDetalhe) : []),
    [formaPagamentoDetalhe, vendasFiltradas],
  );
  const faturamentoPorDia = useMemo(() => agruparVendasPorDiaDoMes(vendas), [vendas]);

  const totalAtendimentoAberto = useMemo(() => {
    if (!atendimentoAberto) return 0;

    const servico = firstRelation(atendimentoAberto.servicos);
    const totalServico = obterPrecoServicoNoDia(servico, atendimentoAberto.data_agendamento);
    const totalProdutos = produtos.reduce((total, produto) => {
      const quantidade = Number(itensVenda[produto.id] || 0);
      return total + quantidade * (produto.preco || 0);
    }, 0);

    return totalServico + totalProdutos;
  }, [atendimentoAberto, itensVenda, produtos]);

  async function carregarDados() {
    if (!isSupabaseConfigured) {
      setMensagem("Supabase nao configurado. Confira o .env.local.");
      return;
    }

    const token = session?.access_token;
    let empresaAtual: Empresa | null = null;

    if (token) {
      const empresaResponse = await fetch("/api/my-company", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const empresaPayload = await empresaResponse.json().catch(() => null);

      if (empresaResponse.ok && empresaPayload?.empresa) {
        empresaAtual = empresaPayload.empresa as Empresa;
      } else {
        const email = empresaPayload?.user?.email ? ` (${empresaPayload.user.email})` : "";
        const id = empresaPayload?.user?.id ? ` ID: ${empresaPayload.user.id}` : "";
        setMensagem(
          `${empresaPayload?.error || "Nenhuma empresa encontrada para este login."}${email}${id ? `.${id}` : ""}`,
        );
        return;
      }
    } else {
      const { data } = await supabase
        .from("empresas")
        .select(EMPRESA_SELECT)
        .eq("id", EMPRESA_ID_LEGADO)
        .maybeSingle();

      empresaAtual = (data as Empresa | null) || null;
    }

    if (!empresaAtual) {
      setMensagem("Nenhuma empresa encontrada para este login. Vincule o usuario a uma barbearia no Supabase.");
      return;
    }

    const empresaId = empresaAtual.id;
    const [
      servicosResponse,
      agendamentosResponse,
      produtosResponse,
      clientesResponse,
      vendasResponse,
      perfilResponse,
      profissionaisResponse,
    ] = await Promise.all([
      supabase.from("servicos").select("id,nome,preco,duracao,precos_por_dia,foto_url").eq("empresa_id", empresaId).order("nome"),
      supabase
        .from("agendamentos")
        .select(
          "id,cliente_id,servico_id,profissional_id,data_agendamento,status,lembrete_enviado_em,lembrete_status,clientes(id,nome,telefone,data_nascimento),servicos(nome,preco,duracao,precos_por_dia),profissionais(id,nome,foto_url)",
        )
        .eq("empresa_id", empresaId)
        .neq("status", "cancelado")
        .order("data_agendamento", { ascending: true }),
      supabase
        .from("produtos")
        .select("id,nome,preco,preco_custo,estoque,foto_url,comissao_percentual")
        .eq("empresa_id", empresaId)
        .order("nome"),
      supabase
        .from("clientes")
        .select("id,nome,telefone,data_nascimento")
        .eq("empresa_id", empresaId)
        .order("nome", { ascending: true }),
      supabase
        .from("vendas")
        .select(
          "id,created_at,total,forma_pagamento,agendamento_id,agendamentos(data_agendamento,profissional_id,clientes(nome),profissionais(nome),servicos(nome,preco)),venda_itens(produto_id,quantidade,valor_unitario,produtos(nome))",
        )
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false }),
      authenticatedFetch(`/api/company-profile?empresaId=${empresaId}`, { cache: "no-store" })
        .then((response) => response.json())
        .catch(() => null),
      supabase.from("profissionais").select("id,nome,foto_url,ativo").eq("empresa_id", empresaId).order("nome"),
    ]);

    setEmpresa(empresaAtual);
    setConfigDias(empresaAtual.dias_atendimento?.length ? empresaAtual.dias_atendimento : DIAS_ATENDIMENTO_PADRAO);
    setConfigHorarios(
      empresaAtual.horarios_atendimento?.length ? empresaAtual.horarios_atendimento : HORARIOS_ATENDIMENTO_PADRAO,
    );

    if (servicosResponse.data) setServicos(servicosResponse.data as Servico[]);
    if (agendamentosResponse.data) setAgendamentos(agendamentosResponse.data as unknown as Agendamento[]);
    if (profissionaisResponse.data) setProfissionais(profissionaisResponse.data as Profissional[]);
    if (clientesResponse.data) setClientes(clientesResponse.data as ClienteResumo[]);

    const nomeResponsavel = perfilResponse?.empresa?.nome_responsavel || "";
    setNomeDono(nomeResponsavel);
    if (nomeResponsavel) {
      window.localStorage.setItem(DONO_STORAGE_KEY, nomeResponsavel);
    } else {
      window.localStorage.removeItem(DONO_STORAGE_KEY);
    }

    if (produtosResponse.error) {
      setProdutoAviso("Tabela produtos ainda nao encontrada no Supabase.");
      setProdutos([]);
    } else {
      setProdutoAviso("");
      setProdutos((produtosResponse.data || []) as Produto[]);
    }

    if (vendasResponse.error) {
      setFinanceiroAviso("Financeiro ainda nao configurado no Supabase. Rode o SQL de vendas para ativar.");
      setVendas([]);
    } else {
      setFinanceiroAviso("");
      setVendas((vendasResponse.data || []) as unknown as Venda[]);
    }

    if (servicosResponse.error || agendamentosResponse.error || clientesResponse.error) {
      setMensagem("Alguns dados nao puderam ser carregados. Confira as politicas RLS no Supabase.");
    }
  }

  useEffect(() => {
    if (!empresa?.features) return;
    const root = document.documentElement;
    const f = empresa.features;
    if (f.cor_primaria) {
      root.style.setProperty("--brand-start", f.cor_primaria);
      root.style.setProperty("--brand-btn-end", f.cor_primaria);
    }
    if (f.cor_secundaria) {
      root.style.setProperty("--brand-end", f.cor_secundaria);
      root.style.setProperty("--brand-btn-start", f.cor_secundaria);
    }
  }, [empresa]);

  useEffect(() => {
    async function verificarSessao() {
      if (!isSupabaseConfigured) {
        setAuthReady(true);
        return;
      }

      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setAuthReady(true);
    }

    verificarSessao();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function carregarPainelAutenticado() {
      if (!session) return;
      await carregarDados();
    }

    carregarPainelAutenticado();
  }, [session]);

  async function entrarNoPainel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!loginEmail || !loginSenha) {
      setMensagem("Informe o email e a senha do painel.");
      return;
    }

    if (!isSupabaseConfigured) {
      setMensagem("Supabase nao configurado. Confira NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setLoginCarregando(true);
    setMensagem("Validando acesso...");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginSenha,
    });

    setLoginCarregando(false);

    if (error) {
      setMensagem("Email ou senha invalidos para o painel da barbearia.");
      return;
    }

    setSession(data.session);
    setMensagem("");
  }

  async function recuperarSenha() {
    if (!loginEmail) {
      setMensagem("Informe o email do painel para receber o link de recuperacao.");
      return;
    }

    setLoginCarregando(true);
    setMensagem("Enviando email de recuperacao...");

    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
      redirectTo: `${window.location.origin}/login`,
    });

    setLoginCarregando(false);

    if (error) {
      setMensagem(`Erro ao recuperar senha: ${error.message}`);
      return;
    }

    setMensagem("Se esse email estiver cadastrado, enviaremos um link para redefinir a senha.");
  }

  async function sairDoPainel() {
    await supabase.auth.signOut();
    setSession(null);
    setEmpresa(null);
    setServicos([]);
    setProdutos([]);
    setAgendamentos([]);
    setVendas([]);
    setClientes([]);
    setMensagem("");
  }

  async function cadastrarServico(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!servicoForm.nome || !servicoForm.preco) {
      setMensagem("Informe nome e preco do servico.");
      return;
    }

    setSalvandoServico(true);
    const { error } = await supabase.from("servicos").insert({
      duracao: Number(servicoForm.duracao || 30),
      empresa_id: empresaIdAtual,
      foto_url: servicoForm.foto_url.trim() || null,
      nome: servicoForm.nome.trim(),
      preco: Number(servicoForm.preco),
    });
    setSalvandoServico(false);

    if (error) {
      setMensagem(`Erro ao cadastrar servico: ${formatarErroSupabase(error.message)}`);
      return;
    }

    setServicoForm({ duracao: "30", foto_url: "", nome: "", preco: "" });
    await carregarDados();
    setMensagem("Servico cadastrado com sucesso.");
  }

  async function cadastrarProduto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!produtoForm.nome) {
      setMensagem("Informe o nome do produto.");
      return;
    }

    setSalvandoProduto(true);
    const { error } = await supabase.from("produtos").insert({
      empresa_id: empresaIdAtual,
      comissao_percentual: produtoForm.comissao ? Number(produtoForm.comissao) : null,
      estoque: Number(produtoForm.estoque || 0),
      foto_url: produtoForm.foto_url.trim() || null,
      nome: produtoForm.nome.trim(),
      preco: produtoForm.preco ? Number(produtoForm.preco) : null,
      preco_custo: produtoForm.custo ? Number(produtoForm.custo) : null,
    });
    setSalvandoProduto(false);

    if (error) {
      setMensagem(`Erro ao cadastrar produto: ${formatarErroSupabase(error.message)}`);
      return;
    }

    setProdutoForm({ comissao: "", custo: "", estoque: "0", foto_url: "", nome: "", preco: "" });
    setAddProdutoOpen(false);
    await carregarDados();
    setMensagem("Produto cadastrado com sucesso.");
  }

  async function atualizarServico(servico: Servico) {
    const { error } = await supabase
      .from("servicos")
      .update({
        duracao: servico.duracao || 30,
        foto_url: servico.foto_url || null,
        nome: servico.nome,
        preco: servico.preco,
        precos_por_dia: servico.precos_por_dia && Object.keys(servico.precos_por_dia).length > 0 ? servico.precos_por_dia : null,
      })
      .eq("id", servico.id)
      .eq("empresa_id", empresaIdAtual);

    if (error) {
      setMensagem(`Erro ao atualizar servico: ${formatarErroSupabase(error.message)}`);
      return;
    }

    await carregarDados();
    setMensagem("Servico atualizado com sucesso.");
  }

  async function atualizarProduto(produto: Produto) {
    const { error } = await supabase
      .from("produtos")
      .update({
        comissao_percentual: produto.comissao_percentual || null,
        estoque: produto.estoque || 0,
        foto_url: produto.foto_url || null,
        nome: produto.nome,
        preco: produto.preco,
        preco_custo: produto.preco_custo || null,
      })
      .eq("id", produto.id)
      .eq("empresa_id", empresaIdAtual);

    if (error) {
      setMensagem(`Erro ao atualizar produto: ${formatarErroSupabase(error.message)}`);
      return;
    }

    await carregarDados();
    setMensagem("Produto atualizado com sucesso.");
  }

  async function excluirServico(servicoId: number) {
    const response = await authenticatedFetch(`/api/servicos?id=${servicoId}&empresaId=${empresaIdAtual}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setMensagem(data?.error || "Nao foi possivel excluir o servico.");
      return;
    }

    setServicos((atuais) => atuais.filter((s) => s.id !== servicoId));
    setMensagem("Servico excluido com sucesso.");
  }

  async function excluirProduto(produtoId: number) {
    const response = await authenticatedFetch(`/api/produtos?id=${produtoId}&empresaId=${empresaIdAtual}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setMensagem(data?.error || "Nao foi possivel excluir o produto.");
      return;
    }

    setProdutos((atuais) => atuais.filter((p) => p.id !== produtoId));
    setMensagem("Produto excluido com sucesso.");
  }

  async function atualizarCliente(cliente: ClienteResumo) {
    const nome = cliente.nome.trim();
    const telefone = normalizarTelefoneBrasil(cliente.telefone || "");

    if (!nome) {
      setMensagem("Informe o nome do cliente.");
      return;
    }

    if (telefone && (telefone.length < 12 || telefone.length > 13)) {
      setMensagem("Informe um WhatsApp valido com DDD. Exemplo: 18981518787.");
      return;
    }

    const response = await authenticatedFetch("/api/clientes", {
      body: JSON.stringify({
        data_nascimento: cliente.data_nascimento || null,
        empresaId: empresaIdAtual,
        id: cliente.id,
        nome,
        telefone: telefone || null,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setMensagem(`Erro ao atualizar cliente: ${formatarErroSupabase(data?.error || "Nao foi possivel salvar.")}`);
      return;
    }

    const clienteAtualizado = data?.cliente as ClienteResumo | undefined;

    if (clienteAtualizado) {
      setClientes((atuais) => atuais.map((item) => (item.id === clienteAtualizado.id ? clienteAtualizado : item)));
      setAgendamentos((atuais) =>
        atuais.map((agendamento) =>
          agendamento.cliente_id === clienteAtualizado.id
            ? { ...agendamento, clientes: clienteAtualizado }
            : agendamento,
        ),
      );
    }

    await carregarDados();
    setMensagem("Cliente atualizado com sucesso.");
  }

  async function excluirCliente(clienteId: number) {
    const response = await authenticatedFetch(
      `/api/clientes?id=${clienteId}&empresaId=${empresaIdAtual}`,
      { method: "DELETE" }
    );
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setMensagem(data?.error || "Nao foi possivel excluir o cliente.");
      return;
    }

    setClientes((atuais) => atuais.filter((c) => c.id !== clienteId));
    setMensagem("Cliente excluido com sucesso.");
  }

  async function copiarLink() {
    await navigator.clipboard.writeText(linkPublico);
    setMensagem("Link publico copiado para enviar aos clientes.");
  }

  async function marcarLembreteEnviado(agendamento: Agendamento) {
    const enviadoEm = new Date().toISOString();
    const { error } = await supabase
      .from("agendamentos")
      .update({ lembrete_enviado_em: enviadoEm, lembrete_status: "enviado" })
      .eq("id", agendamento.id)
      .eq("empresa_id", empresaIdAtual);

    if (error) {
      setMensagem(`WhatsApp aberto, mas nao consegui marcar o lembrete: ${formatarErroSupabase(error.message)}`);
      return false;
    }

    setAgendamentos((atuais) =>
      atuais.map((item) =>
        item.id === agendamento.id ? { ...item, lembrete_enviado_em: enviadoEm, lembrete_status: "enviado" } : item,
      ),
    );

    return true;
  }

  async function enviarPushLembretes(agendamentoIds: number[]) {
    try {
      const response = await fetch("/api/push/reminders", {
        body: JSON.stringify({ agendamentoIds, empresaId: empresaIdAtual }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) return data?.error || "Nao consegui enviar a notificacao push.";
      if (!data?.configured) return data?.error || "Push nao configurado no servidor.";
      if ((data.sent || 0) === 0) {
        return "Nenhuma notificacao push foi entregue. O cliente precisa ativar as notificacoes no aparelho dele.";
      }
      return `${data.sent} notificacao push enviada.`;
    } catch {
      return "Nao consegui enviar a notificacao push.";
    }
  }

  async function enviarWhatsAppAutomatico(agendamentoIds: number[]) {
    try {
      const response = await fetch("/api/whatsapp/reminders", {
        body: JSON.stringify({ agendamentoIds, empresaId: empresaIdAtual }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.configured) {
        return { configured: false, resumo: "", sentAppointmentIds: [] as number[] };
      }

      const resumo = data.sent
        ? `${data.sent} lembrete(s) enviado(s) automaticamente pelo WhatsApp.`
        : data.error || "Nenhum lembrete foi enviado automaticamente pelo WhatsApp.";

      return { configured: true, resumo, sentAppointmentIds: (data.sentAppointmentIds || []) as number[] };
    } catch {
      return { configured: false, resumo: "", sentAppointmentIds: [] as number[] };
    }
  }

  async function enviarLembrete(agendamento: Agendamento, resumoPush?: string) {
    const cliente = firstRelation(agendamento.clientes);
    const servico = firstRelation(agendamento.servicos);
    const telefoneLimpo = normalizarTelefoneBrasil(cliente?.telefone || "");

    if (!telefoneLimpo) {
      setMensagem("Este cliente nao informou WhatsApp no agendamento.");
      return;
    }

    const pushMensagem = resumoPush || (await enviarPushLembretes([agendamento.id]));
    const whatsappAuto = await enviarWhatsAppAutomatico([agendamento.id]);
    const enviadoAutomaticamente = whatsappAuto.sentAppointmentIds.includes(agendamento.id);

    if (!enviadoAutomaticamente) {
      const texto = encodeURIComponent(
      `Ola, ${cliente?.nome || "tudo bem"}! Passando para lembrar seu agendamento de ${servico?.nome || "servico"} em ${new Date(
        agendamento.data_agendamento,
      ).toLocaleString("pt-BR")}.`,
      );
      window.open(`https://wa.me/${telefoneLimpo}?text=${texto}`, "_blank", "noopener,noreferrer");
    }
    const lembreteMarcado = await marcarLembreteEnviado(agendamento);

    if (lembreteMarcado) {
      const detalhe = whatsappAuto.configured ? whatsappAuto.resumo : "";
      setMensagem(`Lembrete de ${cliente?.nome || "cliente"} marcado como enviado. ${detalhe} ${pushMensagem}`.trim());
    }
  }

  async function enviarLembretesDoDia() {
    const pendentes = lembretesDeHoje.filter((agendamento) => {
      const cliente = firstRelation(agendamento.clientes);
      return cliente?.telefone && !agendamento.lembrete_enviado_em;
    });

    if (pendentes.length === 0) {
      setMensagem("Nao ha lembretes pendentes com WhatsApp informado para hoje.");
      return;
    }

    try {
      await fetch("/api/push/reminders", {
        body: JSON.stringify({
          agendamentoIds: pendentes.map((agendamento) => agendamento.id),
          empresaId: empresaIdAtual,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch {
      // O WhatsApp continua funcionando mesmo se o push nao estiver configurado.
    }

    await enviarLembrete(pendentes[0]);

    if (pendentes.length > 1) {
      setMensagem(
        `Abrimos o WhatsApp do primeiro cliente. Ao voltar para o painel, toque novamente para enviar o proximo. Restam ${
          pendentes.length - 1
        } lembretes.`,
      );
    }
  }

  function abrirFinalizacao(agendamento: Agendamento) {
    setAtendimentoAberto(agendamento);
    setItensVenda({});
    setFormaPagamentoVenda("");
    setAvisoFinalizacao("");
  }

  async function cancelarAgendamentoDono(agendamento: Agendamento) {
    const { error } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", agendamento.id)
      .eq("empresa_id", empresaIdAtual);

    if (error) {
      setMensagem(`Erro ao cancelar: ${formatarErroSupabase(error.message)}`);
      return;
    }

    await carregarDados();
    setMensagem("Agendamento cancelado.");
  }

  async function atribuirProfissionalAgendamento(agendamento: Agendamento, profissionalId: number | null) {
    const profissionalValido = profissionalId === null || profissionais.some((item) => item.id === profissionalId && item.ativo !== false);

    if (!profissionalValido) {
      setMensagem("Profissional invalido para este agendamento.");
      return;
    }

    const { error } = await supabase
      .from("agendamentos")
      .update({ profissional_id: profissionalId })
      .eq("id", agendamento.id)
      .eq("empresa_id", empresaIdAtual);

    if (error) {
      setMensagem(`Erro ao atribuir profissional: ${formatarErroSupabase(error.message)}`);
      return;
    }

    setAgendamentos((atuais) =>
      atuais.map((item) => (item.id === agendamento.id ? { ...item, profissional_id: profissionalId } : item)),
    );
  }

  async function criarAgendamentoManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const profissionaisAtivos = profissionais.filter((p) => p.ativo !== false);
    const exigeProfissional = profissionaisAtivos.length > 1;
    const nome = novoAgendamentoForm.clienteNome.trim();
    const telefone = normalizarTelefoneBrasil(novoAgendamentoForm.clienteTelefone);
    const servicoId = Number(novoAgendamentoForm.servicoId);
    const profissionalId = novoAgendamentoForm.profissionalId ? Number(novoAgendamentoForm.profissionalId) : null;

    if (!nome || !telefone || !servicoId || !novoAgendamentoForm.data || !novoAgendamentoForm.horario) {
      setMensagem("Preencha cliente, WhatsApp, servico, dia e horario para agendar.");
      return;
    }

    if (exigeProfissional && !profissionalId) {
      setMensagem("Selecione o profissional para este agendamento.");
      return;
    }

    if (telefone.length < 12 || telefone.length > 13) {
      setMensagem("Informe um WhatsApp valido com DDD. Exemplo: 18981518787.");
      return;
    }

    const servico = servicos.find((s) => s.id === servicoId);
    const duracaoMin = servico?.duracao && servico.duracao > 0 ? servico.duracao : AGENDA_DURACAO_PADRAO_MIN;
    const inicioNovo = new Date(`${novoAgendamentoForm.data}T${novoAgendamentoForm.horario}:00`).getTime();
    const fimNovo = inicioNovo + duracaoMin * 60000;

    const conflito = agendamentosAtivos.find((item) => {
      if (exigeProfissional && item.profissional_id !== profissionalId) return false;

      const outroServico = firstRelation(item.servicos);
      const outraDuracao = outroServico?.duracao && outroServico.duracao > 0 ? outroServico.duracao : AGENDA_DURACAO_PADRAO_MIN;
      const outroInicio = new Date(item.data_agendamento).getTime();
      const outroFim = outroInicio + outraDuracao * 60000;

      return inicioNovo < outroFim && fimNovo > outroInicio;
    });

    if (conflito) {
      const clienteConflito = firstRelation(conflito.clientes);
      setMensagem(`Horario indisponivel: ja existe um agendamento de ${clienteConflito?.nome || "outro cliente"} nesse periodo.`);
      return;
    }

    setSalvandoNovoAgendamento(true);
    setMensagem("Criando agendamento...");

    const { data: clienteExistente } = await supabase
      .from("clientes")
      .select("id")
      .eq("empresa_id", empresaIdAtual)
      .eq("telefone", telefone)
      .maybeSingle();

    let clienteId: number;

    if (clienteExistente) {
      clienteId = clienteExistente.id;
    } else {
      const { data: novoCliente, error: erroCliente } = await supabase
        .from("clientes")
        .insert({ empresa_id: empresaIdAtual, nome, telefone })
        .select("id")
        .single();

      if (erroCliente) {
        setSalvandoNovoAgendamento(false);
        setMensagem(`Erro ao cadastrar cliente: ${formatarErroSupabase(erroCliente.message)}`);
        return;
      }

      clienteId = novoCliente.id;
    }

    const { error: agendamentoError } = await supabase.from("agendamentos").insert({
      cliente_id: clienteId,
      data_agendamento: `${novoAgendamentoForm.data} ${novoAgendamentoForm.horario}:00`,
      empresa_id: empresaIdAtual,
      profissional_id: profissionalId,
      servico_id: servicoId,
      status: "confirmado",
    });

    setSalvandoNovoAgendamento(false);

    if (agendamentoError) {
      setMensagem(`Erro ao criar agendamento: ${formatarErroSupabase(agendamentoError.message)}`);
      return;
    }

    setDiaAgendaSelecionado(novoAgendamentoForm.data);
    setNovoAgendamentoAberto(false);
    setNovoAgendamentoForm({
      clienteNome: "",
      clienteTelefone: "",
      data: dataLocalISO(),
      horario: "",
      profissionalId: "",
      servicoId: "",
    });
    await carregarDados();
    setMensagem(`Agendamento de ${nome} criado com sucesso.`);
  }

  function abrirSecao(secao: AdminSection) {
    setActiveSection(secao);
    setMobileDrawerOpen(false);
  }

  function alternarDiaAtendimento(dia: number) {
    setConfigDias((atuais) => {
      const proximos = atuais.includes(dia) ? atuais.filter((item) => item !== dia) : [...atuais, dia];
      return proximos.sort((a, b) => a - b);
    });
  }

  function adicionarHorarioAtendimento() {
    if (!novoHorario) return;

    setConfigHorarios((atuais) => Array.from(new Set([...atuais, novoHorario])).sort());
    setNovoHorario("");
  }

  function removerHorarioAtendimento(horario: string) {
    setConfigHorarios((atuais) => atuais.filter((item) => item !== horario));
  }

  async function salvarConfiguracaoAgenda() {
    if (configDias.length === 0) {
      setMensagem("Selecione pelo menos um dia de atendimento.");
      return;
    }

    if (configHorarios.length === 0) {
      setMensagem("Adicione pelo menos um horario de atendimento.");
      return;
    }

    setSalvandoConfiguracao(true);
    const response = await authenticatedFetch("/api/schedule-config", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dias_atendimento: configDias,
        empresaId: empresaIdAtual,
        horarios_atendimento: configHorarios,
      }),
    });
    const data = await response.json().catch(() => null);
    setSalvandoConfiguracao(false);

    if (!response.ok) {
      setMensagem(`Erro ao salvar configuracoes: ${formatarErroSupabase(data?.error || "Nao foi possivel salvar.")}`);
      return;
    }

    const diasSalvos = Array.isArray(data?.dias_atendimento) ? data.dias_atendimento : configDias;
    const horariosSalvos = Array.isArray(data?.horarios_atendimento) ? data.horarios_atendimento : configHorarios;

    setConfigDias(diasSalvos);
    setConfigHorarios(horariosSalvos);
    setEmpresa((empresaAtual) =>
      empresaAtual
        ? {
            ...empresaAtual,
            dias_atendimento: diasSalvos,
            horarios_atendimento: horariosSalvos,
          }
        : empresaAtual,
    );
    await carregarDados();
    setMensagem("Configuracoes de agenda salvas com sucesso.");
  }

  async function salvarNomeDono() {
    const nome = nomeDono.trim();
    const response = await authenticatedFetch("/api/company-profile", {
      body: JSON.stringify({ empresaId: empresaIdAtual, nome_responsavel: nome || null }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setMensagem(data?.error || "Nao foi possivel salvar o nome do dono.");
      return;
    }

    window.localStorage.setItem(DONO_STORAGE_KEY, data?.empresa?.nome_responsavel || nome);
    setNomeDono(data?.empresa?.nome_responsavel || nome);
    setMensagem(nome ? `Nome salvo. A tela inicial agora mostra Olá, ${nome}.` : "Nome removido da tela inicial.");
  }

  async function ativarLicenca(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!empresa) return;

    const token = licencaToken.trim();

    if (!token) {
      setMensagem("Cole a chave de liberacao enviada para esta barbearia.");
      return;
    }

    setLicencaCarregando(true);
    setMensagem("Validando licenca...");

    const response = await fetch("/api/license/activate", {
      body: JSON.stringify({ empresaId: empresa.id, token }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const data = await response.json().catch(() => null);
    setLicencaCarregando(false);

    if (!response.ok) {
      setMensagem(data?.error || "Nao foi possivel ativar a licenca.");
      return;
    }

    setLicencaToken("");
    setEmpresa((empresaAtual) => (empresaAtual ? { ...empresaAtual, ...data.empresa } : empresaAtual));
    await carregarDados();
    setMensagem("Licenca ativada com sucesso.");
  }

  async function finalizarAtendimento() {
    if (!atendimentoAberto) return;

    const novaVenda = montarVendaFinalizacao({
      agendamentoId: atendimentoAberto.id,
      empresaId: empresaIdAtual,
      formaPagamento: formaPagamentoVenda,
      total: totalAtendimentoAberto,
    });

    if (!novaVenda.ok) {
      setAvisoFinalizacao(novaVenda.erro);
      return;
    }
    setAvisoFinalizacao("");

    const itensSelecionados = produtos
      .map((produto) => ({
        produto,
        quantidade: Number(itensVenda[produto.id] || 0),
      }))
      .filter((item) => item.quantidade > 0);

    setFinalizandoVenda(true);
    setMensagem("Finalizando atendimento e registrando venda...");

    const { data: venda, error: vendaError } = await supabase
      .from("vendas")
      .insert(novaVenda.venda)
      .select("id")
      .single();

    if (vendaError) {
      setFinalizandoVenda(false);
      setMensagem(`Erro ao finalizar venda: ${formatarErroSupabase(vendaError.message)}`);
      return;
    }

    if (itensSelecionados.length > 0) {
      const { error: itensError } = await supabase.from("venda_itens").insert(
        itensSelecionados.map(({ produto, quantidade }) => ({
          produto_id: produto.id,
          quantidade,
          valor_unitario: produto.preco || 0,
          venda_id: venda.id,
        })),
      );

      if (itensError) {
        setFinalizandoVenda(false);
        setMensagem(`Venda criada, mas os produtos nao foram lancados: ${formatarErroSupabase(itensError.message)}`);
        return;
      }

      await Promise.all(
        itensSelecionados.map(({ produto, quantidade }) =>
          supabase
            .from("produtos")
            .update({ estoque: Math.max((produto.estoque || 0) - quantidade, 0) })
            .eq("id", produto.id)
            .eq("empresa_id", empresaIdAtual),
        ),
      );
    }

    await supabase
      .from("agendamentos")
      .update({ status: "finalizado" })
      .eq("id", atendimentoAberto.id)
      .eq("empresa_id", empresaIdAtual);

    setFinalizandoVenda(false);
    setAtendimentoAberto(null);
    await carregarDados();
    setMensagem(`Atendimento finalizado. Total registrado: ${formatarMoeda(totalAtendimentoAberto)}.`);
  }

  // Usa somente os dados ja carregados (RLS da empresa logada) e os filtros ativos na tela.
  function gerarPdfFinanceiro() {
    const profissionalSelecionado =
      visaoBalanco === "geral" ? null : profissionais.find((profissional) => profissional.id === visaoBalanco) || null;
    const pdf = gerarRelatorioFinanceiroPdf({
      empresa: empresa?.nome || "",
      formasPagamento: resumoFinanceiro.formasPagamento,
      geradoEm: new Date(),
      pendencias: resumoFinanceiro.pendencias,
      periodo: intervaloFinanceiro.descricao,
      profissional: profissionalSelecionado
        ? { atendimentos: vendasFiltradas.length, nome: profissionalSelecionado.nome, receita: resumoFinanceiro.totalReceita }
        : null,
      receita: resumoFinanceiro.totalReceita,
      taxaOcupacao: resumoFinanceiro.taxaOcupacao,
      ticketMedio: resumoFinanceiro.ticketMedio,
      upsellProduto: resumoFinanceiro.upsellProduto,
      vendas: listarDetalhesVendas(vendasFiltradas),
      visao: profissionalSelecionado ? `Profissional: ${profissionalSelecionado.nome}` : "Geral",
    });
    const sufixo = mesFinanceiro
      ? `${mesFinanceiro.year}-${String(mesFinanceiro.month).padStart(2, "0")}`
      : periodoFinanceiro === "todos"
        ? "tudo"
        : periodoFinanceiro === "hoje"
          ? dataLocalISO(new Date())
          : `${periodoFinanceiro}-dias`;
    const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-financeiro-${sufixo}.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!authReady) {
    return (
      <main className="admin-login-page">
        <section className="admin-login-panel">
          <p className="admin-kicker">BMS Sistema</p>
          <h1>Carregando painel</h1>
          <p>Estamos verificando o acesso da barbearia.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="admin-login-page">
        <section className="admin-login-panel">
          <div>
            <p className="admin-kicker">Painel da barbearia</p>
            <h1>Acesso profissional</h1>
            <p>Entre com o email e senha fornecidos para administrar agenda, servicos, produtos e clientes.</p>
          </div>

          {mensagem && <p className="admin-login-message">{mensagem}</p>}

          <form className="admin-login-form" onSubmit={entrarNoPainel}>
            <label>
              Email
              <input
                autoComplete="email"
                inputMode="email"
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="barbearia@email.com"
                type="email"
                value={loginEmail}
              />
            </label>

            <label>
              Senha
              <span className="password-field">
                <input
                  autoComplete="current-password"
                  onChange={(event) => setLoginSenha(event.target.value)}
                  placeholder="Senha do painel"
                  type={mostrarSenha ? "text" : "password"}
                  value={loginSenha}
                />
                <button
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  className="password-toggle"
                  onClick={() => setMostrarSenha((atual) => !atual)}
                  type="button"
                >
                  {mostrarSenha ? "Ocultar" : "Ver"}
                </button>
              </span>
            </label>

            <button className="admin-pill-button primary" disabled={loginCarregando || !isSupabaseConfigured} type="submit">
              {loginCarregando ? "Entrando..." : "Entrar no painel"}
            </button>
          </form>

          <div className="admin-login-actions">
            <button disabled={loginCarregando || !isSupabaseConfigured} onClick={recuperarSenha} type="button">
              Esqueci minha senha
            </button>
            <Link href="/agendamentos">Abrir link do cliente</Link>
          </div>

          {!isSupabaseConfigured && (
            <p className="notice notice-error">
              Supabase nao configurado. Reinicie o servidor apos ajustar o arquivo .env.local.
            </p>
          )}
        </section>
      </main>
    );
  }

  if (empresa && licencaExpirada(empresa)) {
    return (
      <main className="admin-login-page">
        {mensagem && (
          <section className="toast-message">
            <span>{mensagem}</span>
            <button aria-label="Fechar notificacao" onClick={() => setMensagem("")} type="button">
              Fechar
            </button>
          </section>
        )}
        <LicenseBlockedPanel
          empresa={empresa}
          isLoading={licencaCarregando}
          onLogout={sairDoPainel}
          onSubmit={ativarLicenca}
          token={licencaToken}
          onTokenChange={setLicencaToken}
        />
      </main>
    );
  }

  return (
    <main className="admin-dashboard">
      {mensagem && (
        <section className="toast-message">
          <span>{mensagem}</span>
          <button aria-label="Fechar notificacao" onClick={() => setMensagem("")} type="button">
            Fechar
          </button>
        </section>
      )}

      <aside className="admin-sidebar">
        <div className="admin-brand">
          {empresa?.features?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Logo" className="empresa-logo" src={empresa.features.logo_url} />
          ) : (
            <span>BMS</span>
          )}
          <div>
            <strong>{empresa?.nome || "Barbearia"}</strong>
            <small>Painel administrativo</small>
          </div>
        </div>

        <nav className="admin-menu" aria-label="Menu do painel">
          <AdminMenuButton
            active={activeSection === "visao"}
            icon="⌂"
            label="Visao geral"
            onClick={() => abrirSecao("visao")}
          />
          <AdminMenuButton active={activeSection === "agenda"} icon="◷" label="Agenda" onClick={() => abrirSecao("agenda")} />
          <AdminMenuButton
            active={activeSection === "servicos"}
            icon="✂"
            label="Servicos"
            onClick={() => abrirSecao("servicos")}
          />
          <AdminMenuButton
            active={activeSection === "produtos"}
            icon="▣"
            label="Produtos"
            onClick={() => abrirSecao("produtos")}
          />
          <AdminMenuButton
            active={activeSection === "financeiro"}
            icon="$"
            label="Financeiro"
            onClick={() => abrirSecao("financeiro")}
          />
          <AdminMenuButton active={activeSection === "clientes"} icon="♡" label="Clientes" onClick={() => abrirSecao("clientes")} />
          <AdminMenuButton active={activeSection === "inteligencia"} icon="✦" label="Inteligencia" onClick={() => abrirSecao("inteligencia")} />
          <AdminMenuButton
            active={activeSection === "configuracoes"}
            icon="⚙"
            label="Configuracoes"
            onClick={() => abrirSecao("configuracoes")}
          />
        </nav>

        <div className="admin-sidebar-footer">
          <LicenseStatusChip empresa={empresa} />
          <Link href="/agendamentos">Link do cliente</Link>
          <button onClick={sairDoPainel} type="button">
            Sair
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <div className="mobile-app-topbar">
            {activeSection !== "agenda" ? (
              <button aria-label="Voltar" onClick={() => abrirSecao("agenda")} type="button">
                ←
              </button>
            ) : (
              <span />
            )}
            {activeSection !== "agenda" ? (
              <div className="topbar-right-group">
                <LicenseStatusChip empresa={empresa} />
                <button aria-label="Abrir menu" onClick={() => setMobileDrawerOpen(true)} type="button">
                  ☰
                </button>
              </div>
            ) : (
              <LicenseStatusChip empresa={empresa} />
            )}
          </div>

          <div>
            <p className="admin-kicker">Painel da barbearia</p>
            <h1>{activeSection === "agenda" ? `Olá, ${nomeDono || empresa?.nome || "barbeiro"}` : empresa?.nome || "BMS Sistema"}</h1>
            <p>{activeSection === "agenda" ? "Você está em sua agenda." : "Gerencie sua barbearia em uma tela simples."}</p>
          </div>

          <div className="admin-header-actions">
            <LicenseStatusChip empresa={empresa} />
            <button className="admin-pill-button secondary" onClick={copiarLink} type="button">
              Copiar link do cliente
            </button>
            <Link className="admin-pill-button primary" href="/agendamentos">
              Ver agendamento
            </Link>
          </div>
        </header>

        <MobileDrawer
          email={session.user.email || ""}
          isOpen={mobileDrawerOpen}
          linkPublico={linkPublico}
          onClose={() => setMobileDrawerOpen(false)}
          onLogout={sairDoPainel}
          onNavigate={abrirSecao}
        />

        <MobileBottomNav
          activeSection={activeSection}
          onNavigate={abrirSecao}
          onOpenMore={() => setMobileDrawerOpen(true)}
        />

        {activeSection === "visao" && (
          <AdminSectionShell
            description="Acompanhe os numeros principais e o que precisa de atencao hoje."
            title="Visao geral"
          >
            <section className="admin-link-card">
              <div className="admin-link-card-intro">
                <span className="admin-link-kicker">Compartilhar</span>
                <h2>Meu link</h2>
                <p>Envie este endereco no WhatsApp, Instagram ou Google Perfil da Empresa.</p>
              </div>
              <div className="admin-link-field">
                <input readOnly value={linkPublico} />
                <button className="admin-link-copy-btn" onClick={copiarLink} type="button">
                  Copiar link
                </button>
              </div>
              <div className="admin-link-share-row">
                <a
                  className="admin-link-share-btn"
                  href={`https://wa.me/?text=${encodeURIComponent(linkPublico)}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span aria-hidden="true">💬</span> WhatsApp
                </a>
                <a
                  className="admin-link-share-btn"
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(linkPublico)}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span aria-hidden="true">f</span> Facebook
                </a>
              </div>
            </section>

            <section className="admin-metrics-grid" aria-label="Resumo da barbearia">
              <MetricCard helper="servicos ativos" label="Servicos" value={servicos.length} />
              <MetricCard helper="produtos cadastrados" label="Produtos" value={produtos.length} />
              <MetricCard helper="agendamentos ativos" label="Agendamentos" value={agendamentosAtivos.length} />
            </section>

            <section className="admin-two-columns">
              <article className="admin-panel">
                <h2>Ranking de agendamentos</h2>
                <RankingList items={ranking} />
              </article>

              <article className="admin-panel">
                <h2>Proximos lembretes</h2>
                <AppointmentList agendamentos={proximosAgendamentos} onFinish={abrirFinalizacao} onNotify={enviarLembrete} />
              </article>
            </section>
          </AdminSectionShell>
        )}

        {activeSection === "agenda" && (
          <section className="admin-section agenda-section agenda-app-shell agenda-app-content">
            <AgendaHero
              agendamentos={agendamentosAtivos}
              dias={diasAgendaPainel}
              diaSelecionado={diaAgendaSelecionado}
              diasComAgendamento={diasComAgendamentoAgenda}
              empresa={empresa}
              nomeDono={nomeDono}
              onNavigateWeek={navegarSemanaAgenda}
              onOpenMenu={() => setMobileDrawerOpen(true)}
              onSelectDia={setDiaAgendaSelecionado}
              vendas={vendas}
            />
            <article className="agenda-timeline-panel agenda-app-main agenda-app-section">
            {profissionais.filter((profissional) => profissional.ativo !== false).length > 0 && (
              <div className="profissional-filtro-strip" aria-label="Filtrar por profissional">
                <button
                  className={filtroProfissionalId === "todos" ? "active" : ""}
                  onClick={() => setFiltroProfissionalId("todos")}
                  type="button"
                >
                  Todos
                </button>
                {profissionais
                  .filter((profissional) => profissional.ativo !== false)
                  .map((profissional) => (
                    <button
                      className={filtroProfissionalId === profissional.id ? "active" : ""}
                      key={profissional.id}
                      onClick={() => setFiltroProfissionalId(profissional.id)}
                      type="button"
                    >
                      {profissional.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" src={profissional.foto_url} />
                      ) : (
                        <span className="photo-placeholder" aria-hidden="true">☺</span>
                      )}
                      {profissional.nome}
                    </button>
                  ))}
              </div>
            )}
            <AgendaTimeline
              agendamentos={agendamentosDoDiaFiltrados}
              diaSelecionado={diaAgendaSelecionado}
              emptyLabel="Nenhum agendamento ativo para este dia."
              horariosAtendimento={empresa?.horarios_atendimento}
              onAssignProfissional={atribuirProfissionalAgendamento}
              onCancel={cancelarAgendamentoDono}
              onFinish={abrirFinalizacao}
              onNotify={enviarLembrete}
              profissionais={profissionais}
            />
            <p className="agenda-horario-footer">
              Seu horario de funcionamento cadastrado e das{" "}
              {formatarHoraMinutos(Math.min(...(empresa?.horarios_atendimento?.length ? empresa.horarios_atendimento : HORARIOS_ATENDIMENTO_PADRAO).map(horaParaMinutos)))}hrs
              {" "}as{" "}
              {formatarHoraMinutos(Math.max(...(empresa?.horarios_atendimento?.length ? empresa.horarios_atendimento : HORARIOS_ATENDIMENTO_PADRAO).map(horaParaMinutos)))}hrs.
              {" "}
              <button onClick={() => abrirSecao("configuracoes")} type="button">
                Editar horarios
              </button>
            </p>
            </article>
            <article className="admin-panel">
              <button
                className="collapsible-panel-trigger"
                onClick={() => setHistoricoAberto((aberto) => !aberto)}
                type="button"
              >
                <span>Historico de atendimentos</span>
                <strong>{historicoAgendamentos.length}</strong>
                <em>{historicoAberto ? "Ocultar" : "Ver atendimentos anteriores"}</em>
              </button>

              {historicoAberto && (
                <>
                  <label className="admin-history-search">
                    Buscar no historico
                    <input
                      onChange={(event) => setBuscaHistorico(event.target.value)}
                      placeholder="Nome, telefone, servico ou data"
                      value={buscaHistorico}
                    />
                  </label>
                  <AppointmentList
                    agendamentos={historicoFiltrado}
                    emptyLabel={
                      buscaHistorico.trim()
                        ? "Nenhum atendimento encontrado para esta busca."
                        : "Nenhum atendimento finalizado ainda."
                    }
                    variant="history"
                  />
                </>
              )}
            </article>
          </section>
        )}

        {activeSection === "agenda" && (
          <div className="agenda-fixed-actions">
            <button aria-label="Travar tela" className="agenda-lock-button" type="button">
              🔒
            </button>
            <button className="agenda-new-button" onClick={() => setNovoAgendamentoAberto(true)} type="button">
              Novo Agendamento <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

        {activeSection === "servicos" && (
          <AdminSectionShell
            description="Cadastre os servicos que aparecem no link publico e edite valores ou duracao."
            title="Servicos"
          >
            <article className="admin-panel">
              <h2>Inserir um novo servico</h2>
              <form className="form-stack add-sheet-form inline-add-form" onSubmit={cadastrarServico}>
                <div className="form-row-foto-nome">
                  <label className="item-foto-picker">
                    Foto
                    <input
                      accept="image/*"
                      className="item-foto-input"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          const dataUrl = await redimensionarFoto(file);
                          setServicoForm((form) => ({ ...form, foto_url: dataUrl }));
                        }
                      }}
                      type="file"
                    />
                    {servicoForm.foto_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={servicoForm.foto_url} />
                    ) : (
                      <span aria-hidden="true">📷</span>
                    )}
                  </label>
                  <label>
                    Nome do servico
                    <input
                      onChange={(event) => setServicoForm((form) => ({ ...form, nome: event.target.value }))}
                      placeholder="Ex: Corte masculino"
                      value={servicoForm.nome}
                    />
                  </label>
                </div>
                <div className="form-row-2">
                  <label>
                    Duracao (min)
                    <select
                      onChange={(event) => setServicoForm((form) => ({ ...form, duracao: event.target.value }))}
                      value={servicoForm.duracao}
                    >
                      {Array.from(new Set([...DURACOES_SERVICO_OPCOES, Number(servicoForm.duracao) || 0]))
                        .filter((minutos) => minutos > 0)
                        .sort((a, b) => a - b)
                        .map((minutos) => (
                          <option key={minutos} value={minutos}>
                            {minutos} min
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Preco
                    <input
                      inputMode="decimal"
                      onChange={(event) => setServicoForm((form) => ({ ...form, preco: event.target.value }))}
                      placeholder="R$ 0,00"
                      type="number"
                      value={servicoForm.preco}
                    />
                  </label>
                </div>
                <button className="admin-pill-button primary wide" disabled={salvandoServico} type="submit">
                  {salvandoServico ? "Salvando..." : "Adicionar a lista"}
                </button>
              </form>
            </article>

            <article className="admin-panel">
              <h2>Lista de servicos</h2>
              <EditableServicoList servicos={servicos} setServicos={setServicos} onSave={atualizarServico} onDelete={excluirServico} />
            </article>
          </AdminSectionShell>
        )}

        {activeSection === "produtos" && (
          <AdminSectionShell
            description="Controle produtos vendidos na barbearia e mantenha estoque e preco organizados."
            title="Produtos"
          >
            {produtoAviso && <p className="notice notice-error">{produtoAviso}</p>}
            <article className="admin-panel">
              <div className="panel-header-with-action">
                <h2>Produtos</h2>
                <button className="add-item-btn" disabled={Boolean(produtoAviso)} onClick={() => setAddProdutoOpen(true)} type="button">+ Novo</button>
              </div>
              <EditableProdutoList produtos={produtos} setProdutos={setProdutos} onSave={atualizarProduto} onDelete={excluirProduto} />
            </article>
          </AdminSectionShell>
        )}

        {addProdutoOpen && (
          <AddFormSheet onClose={() => setAddProdutoOpen(false)} title="Novo produto">
            <form className="form-stack add-sheet-form" onSubmit={cadastrarProduto}>
              <div className="form-row-foto-nome">
                <label className="item-foto-picker">
                  Foto
                  <input
                    accept="image/*"
                    className="item-foto-input"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        const dataUrl = await redimensionarFoto(file);
                        setProdutoForm((form) => ({ ...form, foto_url: dataUrl }));
                      }
                    }}
                    type="file"
                  />
                  {produtoForm.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={produtoForm.foto_url} />
                  ) : (
                    <span aria-hidden="true">📷</span>
                  )}
                </label>
                <label>
                  Nome do produto
                  <input
                    onChange={(event) => setProdutoForm((form) => ({ ...form, nome: event.target.value }))}
                    placeholder="Ex: Pomada"
                    value={produtoForm.nome}
                  />
                </label>
              </div>
              <div className="form-row-4">
                <label>
                  Venda
                  <input
                    inputMode="decimal"
                    onChange={(event) => setProdutoForm((form) => ({ ...form, preco: event.target.value }))}
                    placeholder="R$ 0,00"
                    type="number"
                    value={produtoForm.preco}
                  />
                </label>
                <label>
                  Custo
                  <input
                    inputMode="decimal"
                    onChange={(event) => setProdutoForm((form) => ({ ...form, custo: event.target.value }))}
                    placeholder="R$ 0,00"
                    type="number"
                    value={produtoForm.custo}
                  />
                </label>
                <label>
                  Estoque
                  <input
                    inputMode="numeric"
                    onChange={(event) => setProdutoForm((form) => ({ ...form, estoque: event.target.value }))}
                    type="number"
                    value={produtoForm.estoque}
                  />
                </label>
                <label>
                  Comissao
                  <input
                    inputMode="decimal"
                    onChange={(event) => setProdutoForm((form) => ({ ...form, comissao: event.target.value }))}
                    placeholder="Ex: 20%"
                    type="number"
                    value={produtoForm.comissao}
                  />
                </label>
              </div>
              {produtoForm.preco && produtoForm.custo && Number(produtoForm.custo) > 0 && (
                <p className="produto-lucro-preview">
                  Margem:{" "}
                  <strong>
                    {(((Number(produtoForm.preco) - Number(produtoForm.custo)) / Number(produtoForm.custo)) * 100).toFixed(1)}%
                  </strong>{" "}
                  de lucro
                </p>
              )}
              <button
                className="admin-pill-button primary wide"
                disabled={salvandoProduto}
                type="submit"
              >
                {salvandoProduto ? "Salvando..." : "Adicionar produto"}
              </button>
            </form>
          </AddFormSheet>
        )}

        {activeSection === "financeiro" && (
          <AdminSectionShell
            description="Controle vendas de servicos e produtos depois que o atendimento for finalizado."
            title="Financeiro"
          >
            {financeiroAviso && <p className="notice notice-error">{financeiroAviso}</p>}

            <div className="finance-filter" aria-label="Periodo financeiro">
              <button
                className={!mesFinanceiro && periodoFinanceiro === "hoje" ? "active" : ""}
                onClick={() => {
                  setPeriodoFinanceiro("hoje");
                  setMesFinanceiro(null);
                }}
                type="button"
              >
                Hoje
              </button>
              <button
                className={!mesFinanceiro && periodoFinanceiro === "7" ? "active" : ""}
                onClick={() => {
                  setPeriodoFinanceiro("7");
                  setMesFinanceiro(null);
                }}
                type="button"
              >
                7 dias
              </button>
              <button
                className={!mesFinanceiro && periodoFinanceiro === "30" ? "active" : ""}
                onClick={() => {
                  setPeriodoFinanceiro("30");
                  setMesFinanceiro(null);
                }}
                type="button"
              >
                30 dias
              </button>
              <button
                className={!mesFinanceiro && periodoFinanceiro === "todos" ? "active" : ""}
                onClick={() => {
                  setPeriodoFinanceiro("todos");
                  setMesFinanceiro(null);
                }}
                type="button"
              >
                Tudo
              </button>
            </div>

            {/* Controles funcionais provisorios, sem estilo proprio: o visual sera ajustado depois. */}
            <div aria-label="Filtros do financeiro">
              <label>
                Mes
                <select
                  onChange={(event) => {
                    const month = Number(event.target.value);
                    setMesFinanceiro(month ? { month, year: mesFinanceiro?.year ?? new Date().getFullYear() } : null);
                  }}
                  value={mesFinanceiro?.month ?? ""}
                >
                  <option value="">Periodo acima</option>
                  {MESES_FILTRO.map((mes, index) => (
                    <option key={mes} value={index + 1}>
                      {mes}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ano
                <select
                  disabled={!mesFinanceiro}
                  onChange={(event) => {
                    const year = Number(event.target.value);
                    setMesFinanceiro((atual) => (atual ? { ...atual, year } : atual));
                  }}
                  value={mesFinanceiro?.year ?? new Date().getFullYear()}
                >
                  {anosFinanceiro.map((ano) => (
                    <option key={ano} value={ano}>
                      {ano}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Meu balanco
                <select
                  onChange={(event) => setVisaoBalanco(event.target.value === "geral" ? "geral" : Number(event.target.value))}
                  value={String(visaoBalanco)}
                >
                  <option value="geral">Geral</option>
                  {profissionais.map((profissional) => (
                    <option key={profissional.id} value={profissional.id}>
                      {profissional.nome}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={gerarPdfFinanceiro} type="button">
                Gerar PDF
              </button>
            </div>

            <RevenueBarChart dias={faturamentoPorDia} />

            <ServiceTilesRow items={resumoFinanceiro.servicosMaisVendidos} total={resumoFinanceiro.totalServicosRealizados} />

            <section className="finance-highlight-grid" aria-label="Destaques">
              <MetricCard accent helper="valor medio por venda" label="Ticket medio" value={formatarMoeda(resumoFinanceiro.ticketMedio)} />
              {resumoFinanceiro.taxaOcupacao !== null && (
                <MetricCard helper="agendamentos vs. horarios disponiveis" label="Taxa de ocupacao" value={`${resumoFinanceiro.taxaOcupacao}%`} />
              )}
            </section>

            <section aria-label="Resumo financeiro">
              <div className="finance-metric-scroll">
                <MetricCard
                  helper={`${vendasFiltradas.length} ${vendasFiltradas.length === 1 ? "atendimento" : "atendimentos"}`}
                  label="Faturamento"
                  value={formatarMoeda(resumoFinanceiro.totalReceita)}
                />
                <MetricCard helper="vendas registradas" label="Vendas" value={vendasFiltradas.length} />
                <MetricCard helper="itens com baixo estoque" label="Estoque baixo" value={resumoFinanceiro.estoqueBaixo.length} />
              </div>
              <p className="scroll-hint">
                Arraste para o lado para ver mais <span aria-hidden="true">→</span>
              </p>
            </section>

            <section className="finance-card-grid">
              <PaymentChart items={resumoFinanceiro.formasPagamento} total={resumoFinanceiro.totalReceita} />
              {resumoFinanceiro.distribuicaoHoras && <HoursDistributionBar dados={resumoFinanceiro.distribuicaoHoras} />}
            </section>

            {/* "Ver mais" por forma de pagamento (provisorio, sem estilo proprio). */}
            <div aria-label="Detalhar forma de pagamento">
              <label>
                Ver mais
                <select onChange={(event) => setFormaPagamentoDetalhe(event.target.value || null)} value={formaPagamentoDetalhe ?? ""}>
                  <option value="">Forma de pagamento</option>
                  {resumoFinanceiro.formasPagamento.map((forma) => (
                    <option key={forma.nome} value={forma.nome}>
                      {forma.nome}
                    </option>
                  ))}
                </select>
              </label>
              {formaPagamentoDetalhe && (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Profissional</th>
                      <th>Valor</th>
                      <th>Forma</th>
                      <th>Venda / agendamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalheFormaPagamento.map((linha) => (
                      <tr key={linha.id}>
                        <td>{new Date(linha.data).toLocaleDateString("pt-BR")}</td>
                        <td>{linha.cliente}</td>
                        <td>{linha.profissional}</td>
                        <td>{formatarMoeda(linha.valor)}</td>
                        <td>{linha.formaPagamento}</td>
                        <td>
                          #{linha.id} / {linha.agendamentoId ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <section className="finance-list-card" aria-label="Mais dados">
              <h2>Mais dados</h2>
              <div className="finance-data-row">
                <span>Clientes unicos</span>
                <strong>{resumoFinanceiro.clientesUnicos}</strong>
              </div>
              {resumoFinanceiro.upsellProduto.percentual !== null && (
                <div className="finance-data-row">
                  <span>Upsell produto</span>
                  <strong>{resumoFinanceiro.upsellProduto.percentual}%</strong>
                </div>
              )}
              {resumoFinanceiro.pendencias.percentual !== null && (
                <div className="finance-data-row">
                  <span>Pendencias</span>
                  <strong>
                    {resumoFinanceiro.pendencias.percentual}% ({resumoFinanceiro.pendencias.parte})
                  </strong>
                </div>
              )}
              {resumoFinanceiro.atendimentosPorCliente > 0 && (
                <div className="finance-data-row">
                  <span>Atendimentos por cliente</span>
                  <strong>{resumoFinanceiro.atendimentosPorCliente.toFixed(2)}</strong>
                </div>
              )}
              {resumoFinanceiro.receitaPorHora > 0 && (
                <div className="finance-data-row">
                  <span>Receita por hora</span>
                  <strong>{formatarMoeda(resumoFinanceiro.receitaPorHora)}</strong>
                </div>
              )}
              {resumoFinanceiro.topServico && (
                <div className="finance-data-row">
                  <span>Top servico</span>
                  <strong>{resumoFinanceiro.topServico.nome} ({resumoFinanceiro.topServico.percentual}%)</strong>
                </div>
              )}
            </section>

            <section className="finance-card-grid">
              <FinanceRankingCard items={resumoFinanceiro.produtosMaisVendidos} title="Produtos com mais saida" />
            </section>

            <section className="finance-card-grid">
              <FinanceProductCard emptyLabel="Todos os produtos tiveram giro." produtos={resumoFinanceiro.produtosSemGiro} title="Produtos sem giro" useModal />
              <FinanceProductCard emptyLabel="Nenhum produto cadastrado." produtos={produtos} title="Controle de estoque" useModal />
            </section>
          </AdminSectionShell>
        )}

        {activeSection === "clientes" && (
          <AdminSectionShell
            description="Cadastro, historico e ranking dos seus clientes."
            title="Clientes"
          >
            <div className="section-tabs">
              <button className={abaClientes === "cadastro" ? "active" : ""} onClick={() => setAbaClientes("cadastro")} type="button">Cadastro</button>
              <button className={abaClientes === "historico" ? "active" : ""} onClick={() => setAbaClientes("historico")} type="button">Historico</button>
              <button className={abaClientes === "ranking" ? "active" : ""} onClick={() => setAbaClientes("ranking")} type="button">Ranking</button>
            </div>

            {abaClientes === "cadastro" && (
              <article className="admin-panel">
                <h2>Cadastro de clientes</h2>
                <EditableClienteList clientes={clientes} onDelete={excluirCliente} setClientes={setClientes} onSave={atualizarCliente} />
              </article>
            )}

            {abaClientes === "historico" && (
              <article className="admin-panel">
                <h2>Historico por cliente</h2>
                <HistoricoClientePanel agendamentos={agendamentos} clientes={clientes} vendas={vendas} />
              </article>
            )}

            {abaClientes === "ranking" && (
              <article className="admin-panel">
                <h2>Ranking de clientes</h2>
                <RankingClientePanel agendamentos={agendamentos} clientes={clientes} />
              </article>
            )}
          </AdminSectionShell>
        )}

        {activeSection === "inteligencia" && (
          <AdminSectionShell
            description="Analise inteligente dos seus dados: receita, produtos, sugestoes de compra e promocoes."
            title="Inteligencia"
          >
            <div className="finance-filter" aria-label="Periodo de analise">
              <button
                className={periodoInteligencia === "7" ? "active" : ""}
                onClick={() => setPeriodoInteligencia("7")}
                type="button"
              >
                7 dias
              </button>
              <button
                className={periodoInteligencia === "30" ? "active" : ""}
                onClick={() => setPeriodoInteligencia("30")}
                type="button"
              >
                30 dias
              </button>
              <button
                className={periodoInteligencia === "custom" ? "active" : ""}
                onClick={() => setPeriodoInteligencia("custom")}
                type="button"
              >
                Personalizado
              </button>
            </div>

            {periodoInteligencia === "custom" && (
              <div className="inteligencia-datas-row">
                <label>
                  De
                  <input
                    onChange={(e) => setInteligenciaDataInicio(e.target.value)}
                    type="date"
                    value={inteligenciaDataInicio}
                  />
                </label>
                <label>
                  Ate
                  <input
                    onChange={(e) => setInteligenciaDataFim(e.target.value)}
                    type="date"
                    value={inteligenciaDataFim}
                  />
                </label>
              </div>
            )}

            <InteligenciaPanel
              agendamentos={agendamentos}
              clientes={clientes}
              dataFim={inteligenciaDataFim}
              dataInicio={inteligenciaDataInicio}
              periodo={periodoInteligencia}
              produtos={produtos}
              vendas={vendas}
            />
          </AdminSectionShell>
        )}

        {activeSection === "configuracoes" && (
          <AdminSectionShell
            description="Defina os dias e horarios que aparecem para o cliente no link publico."
            title="Configuracoes"
          >
            <article className="admin-panel schedule-settings">
              <section className="empresa-summary-card">
                <div>
                  <span>Minha empresa</span>
                  <h3>{empresa?.nome || "Sua barbearia"}</h3>
                  <p>{empresa?.plano ? `Plano ${empresa.plano}` : "Sem plano definido"}</p>
                </div>
                {diasRestantesLicenca(empresa) !== null && (
                  <span className="empresa-summary-badge">{diasRestantesLicenca(empresa)}d de licenca</span>
                )}
              </section>

              <section className="owner-profile-card">
                <div>
                  <span>Perfil do dono</span>
                  <h3>Nome que aparece no app</h3>
                  <p>Use esse campo para personalizar a saudacao da agenda. Cada barbearia tera o proprio nome salvo.</p>
                </div>
                <div className="owner-name-row">
                  <input
                    onChange={(event) => setNomeDono(event.target.value)}
                    placeholder="Ex: Bruno"
                    value={nomeDono}
                  />
                  <button className="admin-pill-button primary" onClick={salvarNomeDono} type="button">
                    Salvar nome
                  </button>
                </div>
                <strong>Previa: Ola, {nomeDono || "barbeiro"}</strong>
              </section>

              <div>
                <h2>Agenda de atendimento</h2>
                <p>Os clientes so conseguirao escolher dias e horarios marcados aqui.</p>
              </div>

              <section>
                <h3>Dias disponiveis</h3>
                <div className="day-toggle-grid">
                  {diasCurtos.map((dia, index) => (
                    <button
                      className={configDias.includes(index) ? "active" : ""}
                      key={dia}
                      onClick={() => alternarDiaAtendimento(index)}
                      type="button"
                    >
                      {dia}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3>Horarios disponiveis</h3>
                <div className="time-add-row">
                  <input onChange={(event) => setNovoHorario(event.target.value)} type="time" value={novoHorario} />
                  <button className="admin-pill-button secondary" onClick={adicionarHorarioAtendimento} type="button">
                    Adicionar
                  </button>
                </div>

                <div className="time-chip-grid">
                  {configHorarios.map((horario) => (
                    <button key={horario} onClick={() => removerHorarioAtendimento(horario)} type="button">
                      {horario} <span>remover</span>
                    </button>
                  ))}
                </div>
              </section>

              <button className="admin-pill-button primary wide" disabled={salvandoConfiguracao} onClick={salvarConfiguracaoAgenda} type="button">
                {salvandoConfiguracao ? "Salvando..." : "Salvar configuracoes"}
              </button>
            </article>

            <article className="admin-panel settings-hub-list">
              <h2>Configuracoes adicionais</h2>
              <SettingsHubRow icon="✂" label="Servicos" onClick={() => abrirSecao("servicos")} />
              <SettingsHubRow icon="▣" label="Produtos" onClick={() => abrirSecao("produtos")} />
              <SettingsHubRow icon="♡" label="Clientes" onClick={() => abrirSecao("clientes")} />
              <SettingsHubRow icon="$" label="Financeiro" onClick={() => abrirSecao("financeiro")} />
              <SettingsHubRow icon="✦" label="Inteligencia" onClick={() => abrirSecao("inteligencia")} />
              <SettingsHubRow icon="⌂" label="Meu link do cliente" onClick={() => abrirSecao("visao")} />
            </article>
          </AdminSectionShell>
        )}
      </section>

      <nav className="admin-mobile-nav" aria-label="Menu principal mobile">
        <AdminMenuButton active={activeSection === "agenda"} icon="⌂" label="Inicio" onClick={() => abrirSecao("agenda")} />
        <AdminMenuButton
          active={activeSection === "servicos"}
          icon="✂"
          label="Servicos"
          onClick={() => abrirSecao("servicos")}
        />
        <AdminMenuButton
          active={activeSection === "produtos"}
          icon="▣"
          label="Produtos"
          onClick={() => abrirSecao("produtos")}
        />
        <AdminMenuButton active={activeSection === "financeiro"} icon="$" label="Financeiro" onClick={() => abrirSecao("financeiro")} />
        <AdminMenuButton active={activeSection === "clientes"} icon="♡" label="Clientes" onClick={() => abrirSecao("clientes")} />
        <AdminMenuButton active={activeSection === "inteligencia"} icon="✦" label="IA" onClick={() => abrirSecao("inteligencia")} />
        <AdminMenuButton
          active={activeSection === "configuracoes"}
          icon="⚙"
          label="Config"
          onClick={() => abrirSecao("configuracoes")}
        />
      </nav>

      {novoAgendamentoAberto && (
        <AddFormSheet onClose={() => setNovoAgendamentoAberto(false)} title="Novo agendamento">
          <form className="admin-form" onSubmit={criarAgendamentoManual}>
            <label>
              Nome do cliente
              <input
                onChange={(event) =>
                  setNovoAgendamentoForm((form) => ({ ...form, clienteNome: event.target.value }))
                }
                placeholder="Nome completo"
                value={novoAgendamentoForm.clienteNome}
              />
            </label>
            <label>
              WhatsApp
              <input
                onChange={(event) =>
                  setNovoAgendamentoForm((form) => ({ ...form, clienteTelefone: event.target.value }))
                }
                placeholder="18999998888"
                value={novoAgendamentoForm.clienteTelefone}
              />
            </label>
            <label>
              Servico
              <select
                onChange={(event) =>
                  setNovoAgendamentoForm((form) => ({ ...form, servicoId: event.target.value }))
                }
                value={novoAgendamentoForm.servicoId}
              >
                <option value="">Selecione</option>
                {servicos.map((servico) => (
                  <option key={servico.id} value={servico.id}>
                    {servico.nome} - {formatarMoeda(servico.preco)}
                  </option>
                ))}
              </select>
            </label>
            {profissionais.filter((p) => p.ativo !== false).length > 1 && (
              <label>
                Profissional
                <select
                  onChange={(event) =>
                    setNovoAgendamentoForm((form) => ({ ...form, profissionalId: event.target.value }))
                  }
                  value={novoAgendamentoForm.profissionalId}
                >
                  <option value="">Selecione</option>
                  {profissionais
                    .filter((p) => p.ativo !== false)
                    .map((profissional) => (
                      <option key={profissional.id} value={profissional.id}>
                        {profissional.nome}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Dia
              <input
                onChange={(event) => setNovoAgendamentoForm((form) => ({ ...form, data: event.target.value }))}
                type="date"
                value={novoAgendamentoForm.data}
              />
            </label>
            <label>
              Horario
              <input
                onChange={(event) => setNovoAgendamentoForm((form) => ({ ...form, horario: event.target.value }))}
                type="time"
                value={novoAgendamentoForm.horario}
              />
            </label>
            <button className="admin-pill-button primary wide" disabled={salvandoNovoAgendamento} type="submit">
              {salvandoNovoAgendamento ? "Agendando..." : "Confirmar agendamento"}
            </button>
          </form>
        </AddFormSheet>
      )}

      {atendimentoAberto && (
        <SaleModal
          agendamento={atendimentoAberto}
          aviso={avisoFinalizacao}
          finalizando={finalizandoVenda}
          formaPagamento={formaPagamentoVenda}
          itensVenda={itensVenda}
          onCancel={async () => {
            await cancelarAgendamentoDono(atendimentoAberto);
            setAtendimentoAberto(null);
          }}
          onClose={() => setAtendimentoAberto(null)}
          onConfirm={finalizarAtendimento}
          onNotify={() => enviarLembrete(atendimentoAberto)}
          produtos={produtos}
          setFormaPagamento={(forma) => {
            setFormaPagamentoVenda(forma);
            setAvisoFinalizacao("");
          }}
          setItensVenda={setItensVenda}
          total={totalAtendimentoAberto}
        />
      )}
    </main>
  );
}

function SettingsHubRow({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className="settings-hub-row" onClick={onClick} type="button">
      <span className="settings-hub-row-icon" aria-hidden="true">{icon}</span>
      <span className="settings-hub-row-label">{label}</span>
      <span className="settings-hub-row-chevron" aria-hidden="true">›</span>
    </button>
  );
}

function AdminMenuButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick} type="button">
      <span aria-hidden="true">{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}

function LicenseStatusChip({ empresa }: { empresa: Empresa | null }) {
  const [aberto, setAberto] = useState(false);
  const diasRestantes = diasRestantesLicenca(empresa);

  if (diasRestantes === null) return null;

  const vencimento = empresa?.licenca_expires_at
    ? new Date(empresa.licenca_expires_at).toLocaleDateString("pt-BR")
    : "";
  const statusClass = diasRestantes <= 3 ? "warning" : diasRestantes <= 7 ? "attention" : "";
  const valorClass = diasRestantes <= 3 ? "danger" : diasRestantes <= 7 ? "alert" : "ok";
  const installId = empresa?.licenca_install_id || "ID nao gerado";

  return (
    <>
      <button
        aria-label="Informacoes da licenca"
        className={`license-status-chip ${statusClass}`}
        onClick={() => setAberto(true)}
        type="button"
      >
        <span className="license-dot" aria-hidden="true" />
        <span className="license-chip-text">{diasRestantes}d</span>
      </button>

      {aberto && (
        <div className="license-modal-overlay" onClick={() => setAberto(false)}>
          <div className="license-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Licenca">
            <div className="license-modal-header">
              <strong>Licenca</strong>
              <button aria-label="Fechar" className="license-modal-close" onClick={() => setAberto(false)} type="button">×</button>
            </div>
            <div className="license-modal-body">
              <div className="license-modal-stat">
                <span className="license-modal-stat-label">Status</span>
                <span className="license-modal-stat-value ok">Ativa</span>
              </div>
              <div className="license-modal-stat">
                <span className="license-modal-stat-label">Validade</span>
                <span className="license-modal-stat-value">{vencimento}</span>
              </div>
              <div className="license-modal-stat">
                <span className="license-modal-stat-label">Dias restantes</span>
                <span className={`license-modal-stat-value ${valorClass}`}>{diasRestantes} dias</span>
              </div>
              <div className="license-modal-divider" />
              <div className="license-modal-id-section">
                <span className="license-modal-id-label">ID da licenca — envie para renovar</span>
                <div className="license-modal-id-box">
                  <code>{installId}</code>
                  <button
                    className="license-modal-copy-btn"
                    onClick={() => navigator.clipboard.writeText(installId)}
                    type="button"
                  >
                    Copiar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AdminSectionShell({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="admin-section">
      <div className="admin-section-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function LicenseBlockedPanel({
  empresa,
  isLoading,
  onLogout,
  onSubmit,
  onTokenChange,
  token,
}: {
  empresa: Empresa;
  isLoading: boolean;
  onLogout: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTokenChange: Dispatch<SetStateAction<string>>;
  token: string;
}) {
  const vencimento = empresa.licenca_expires_at
    ? new Date(empresa.licenca_expires_at).toLocaleDateString("pt-BR")
    : "nao informado";

  return (
    <section className="admin-login-panel license-blocked-panel">
      <div>
        <p className="admin-kicker">Licenca bloqueada</p>
        <h1>{empresa.nome}</h1>
        <p>
          O prazo de uso venceu em {vencimento}. Envie o ID abaixo para renovar a licenca e liberar o painel por
          mais 30 dias.
        </p>
      </div>

      <label className="license-install-box">
        ID da licenca
        <input readOnly value={empresa.licenca_install_id || "ID nao criado no Supabase"} />
      </label>

      <form className="admin-login-form" onSubmit={onSubmit}>
        <label>
          Chave de liberacao
          <textarea
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="Cole aqui a chave gerada"
            value={token}
          />
        </label>
        <button className="admin-pill-button primary" disabled={isLoading} type="submit">
          {isLoading ? "Validando..." : "Ativar licenca"}
        </button>
      </form>

      <button className="admin-pill-button secondary" onClick={onLogout} type="button">
        Sair
      </button>
    </section>
  );
}

function MobileDrawer({
  email,
  isOpen,
  linkPublico,
  onClose,
  onLogout,
  onNavigate,
}: {
  email: string;
  isOpen: boolean;
  linkPublico: string;
  onClose: () => void;
  onLogout: () => void;
  onNavigate: (secao: AdminSection) => void;
}) {
  if (!isOpen) return null;

  return (
    <section className="mobile-drawer-backdrop">
      <aside className="mobile-drawer" aria-label="Menu mobile">
        <button aria-label="Fechar menu" className="mobile-drawer-close" onClick={onClose} type="button">
          ×
        </button>
        <h2>BMS Sistema</h2>
        <nav>
          <button onClick={() => onNavigate("agenda")} type="button">
            Inicio
          </button>
          <button onClick={() => onNavigate("visao")} type="button">
            Meu link do cliente
          </button>
          <button onClick={() => onNavigate("clientes")} type="button">
            Clientes
          </button>
          <button onClick={() => onNavigate("agenda")} type="button">
            Agenda
          </button>
          <button onClick={() => onNavigate("financeiro")} type="button">
            Faturamento
          </button>
          <button onClick={() => onNavigate("produtos")} type="button">
            Produtos
          </button>
          <button onClick={() => onNavigate("configuracoes")} type="button">
            Configuracoes
          </button>
          <a href={linkPublico}>Link de agendamento</a>
        </nav>
        <footer>
          <div>
            <strong>{email || "Usuario"}</strong>
            <span>Conta do painel</span>
          </div>
          <button onClick={onLogout} type="button">
            Sair →
          </button>
        </footer>
      </aside>
    </section>
  );
}

function MobileBottomNav({
  activeSection,
  onNavigate,
  onOpenMore,
}: {
  activeSection: AdminSection;
  onNavigate: (secao: AdminSection) => void;
  onOpenMore: () => void;
}) {
  const maisAtivo = !["agenda", "clientes", "financeiro"].includes(activeSection);

  return (
    <nav aria-label="Navegação principal" className="mobile-bottom-nav">
      <button aria-current={activeSection === "agenda" ? "page" : undefined} className={activeSection === "agenda" ? "active" : ""} onClick={() => onNavigate("agenda")} type="button">
        <span aria-hidden="true">◷</span><small>Agenda</small>
      </button>
      <button aria-current={activeSection === "clientes" ? "page" : undefined} className={activeSection === "clientes" ? "active" : ""} onClick={() => onNavigate("clientes")} type="button">
        <span aria-hidden="true">♡</span><small>Clientes</small>
      </button>
      <button aria-current={activeSection === "financeiro" ? "page" : undefined} className={activeSection === "financeiro" ? "active" : ""} onClick={() => onNavigate("financeiro")} type="button">
        <span aria-hidden="true">$</span><small>Financeiro</small>
      </button>
      <button aria-current={maisAtivo ? "page" : undefined} className={maisAtivo ? "active" : ""} onClick={onOpenMore} type="button">
        <span aria-hidden="true">⋯</span><small>Mais</small>
      </button>
    </nav>
  );
}

function BarberChairIcon() {
  return (
    <svg fill="currentColor" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
      <rect height="4" rx="2" width="8" x="8" y="1" />
      <rect height="7" rx="2" width="10" x="7" y="5" />
      <rect height="4" rx="1" width="2" x="4" y="11" />
      <rect height="4" rx="1" width="2" x="18" y="11" />
      <rect height="3" rx="1.5" width="14" x="5" y="12" />
      <rect height="5" width="2" x="11" y="15" />
      <ellipse cx="12" cy="21" rx="6" ry="1.5" />
    </svg>
  );
}

function AgendaHero({
  agendamentos,
  dias,
  diaSelecionado,
  diasComAgendamento,
  empresa,
  nomeDono,
  onNavigateWeek,
  onOpenMenu,
  onSelectDia,
  vendas,
}: {
  agendamentos: Agendamento[];
  dias: DiaPainel[];
  diaSelecionado: string;
  diasComAgendamento?: Set<string>;
  empresa?: Empresa | null;
  nomeDono: string;
  onNavigateWeek: (direcao: -1 | 1) => void;
  onOpenMenu: () => void;
  onSelectDia: (iso: string) => void;
  vendas: Venda[];
}) {
  const hojeIso = dataLocalISO();
  const agendamentosHoje = agendamentos.filter((item) => item.data_agendamento.slice(0, 10) === hojeIso);
  const vendasHoje = vendas.filter((venda) => venda.created_at.slice(0, 10) === hojeIso);
  const totalHoje = vendasHoje.reduce((total, venda) => total + (venda.total || 0), 0);
  const totalSemana = vendas.reduce((total, venda) => total + (venda.total || 0), 0);
  const [valoresOcultos, setValoresOcultos] = useState(false);
  const nomeExibido = nomeDono || empresa?.nome || "barbeiro";
  const exibirValor = (valor: number) => (valoresOcultos ? "R$ ••••" : formatarMoeda(valor));
  const diasAbertos = new Set(empresa?.dias_atendimento?.length ? empresa.dias_atendimento : DIAS_ATENDIMENTO_PADRAO);
  const diaEstaAberto = (iso: string) => diasAbertos.has(new Date(`${iso}T00:00:00`).getDay());

  return (
    <section className="agenda-hero agenda-app-header">
      <div className="agenda-title-row">
        <div className="agenda-owner-row">
          <span className="agenda-owner-avatar" aria-hidden="true">
            {empresa?.features?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={empresa.features.logo_url} />
            ) : (
              nomeExibido.slice(0, 2).toUpperCase()
            )}
          </span>
          <div>
            <h2>Olá, {nomeExibido}</h2>
            <p>Você está em sua agenda.</p>
          </div>
        </div>
        <div className="agenda-title-actions">
          <button
            aria-label={valoresOcultos ? "Mostrar valores" : "Ocultar valores"}
            aria-pressed={valoresOcultos}
            className="agenda-visibility-toggle"
            onClick={() => setValoresOcultos((atual) => !atual)}
            type="button"
          >
            {valoresOcultos ? "⊘" : "◉"}
          </button>
          <button aria-label="Abrir menu" onClick={onOpenMenu} type="button">
            ☰
          </button>
        </div>
      </div>

      <div className="agenda-week-nav">
        <strong className="agenda-week-label">
          <span className="agenda-week-icon" aria-hidden="true">📅</span>
          {dias[0]?.labelCompleto} à {dias[dias.length - 1]?.labelCompleto}
        </strong>
        <div className="agenda-week-arrows">
          <button aria-label="Semana anterior" className="agenda-week-arrow" onClick={() => onNavigateWeek(-1)} type="button">
            ‹
          </button>
          <button aria-label="Proxima semana" className="agenda-week-arrow" onClick={() => onNavigateWeek(1)} type="button">
            ›
          </button>
        </div>
      </div>

      <div className="agenda-day-strip">
        {dias.map((dia) => (
          <button
            aria-current={dia.iso === hojeIso ? "date" : undefined}
            aria-pressed={dia.iso === diaSelecionado}
            className={`agenda-day-card${dia.iso === diaSelecionado ? " active" : ""}${dia.iso === hojeIso ? " today" : ""}`}
            key={dia.iso}
            onClick={() => onSelectDia(dia.iso)}
            type="button"
          >
            <small>{dia.semana}</small>
            <strong>{dia.dia}</strong>
            {(diaEstaAberto(dia.iso) || diasComAgendamento?.has(dia.iso)) && (
              <span className="agenda-day-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <div className="agenda-summary-grid">
        <article className="hot">
          <div className="agenda-summary-top">
            <span className="agenda-summary-icon" aria-hidden="true">💰</span>
            <div><span>Hoje</span><strong>{exibirValor(totalHoje)}</strong></div>
          </div>
          <div className="agenda-summary-count-row">
            <strong className="agenda-summary-count">{agendamentosHoje.length}</strong>
            <span className="agenda-summary-decor" aria-hidden="true"><BarberChairIcon /></span>
          </div>
        </article>
        <article>
          <div className="agenda-summary-top">
            <span className="agenda-summary-icon" aria-hidden="true">💰</span>
            <div><span>Esta semana</span><strong>{exibirValor(totalSemana)}</strong></div>
          </div>
          <div className="agenda-summary-count-row">
            <strong className="agenda-summary-count">{agendamentos.length}</strong>
            <span className="agenda-summary-decor" aria-hidden="true"><BarberChairIcon /></span>
          </div>
        </article>
      </div>
    </section>
  );
}

function AgendaTimeline({
  agendamentos,
  diaSelecionado,
  emptyLabel,
  horariosAtendimento,
  onAssignProfissional,
  onCancel,
  onFinish,
  onNotify,
  profissionais,
}: {
  agendamentos: Agendamento[];
  diaSelecionado: string;
  emptyLabel: string;
  horariosAtendimento?: string[] | null;
  onAssignProfissional?: (agendamento: Agendamento, profissionalId: number | null) => void | Promise<void>;
  onCancel?: (agendamento: Agendamento) => void | Promise<void>;
  onFinish?: (agendamento: Agendamento) => void;
  onNotify?: (agendamento: Agendamento) => void | Promise<void>;
  profissionais?: Profissional[];
}) {
  const [menuAbertoId, setMenuAbertoId] = useState<number | null>(null);

  if (agendamentos.length === 0) return <div className="empty-state">{emptyLabel}</div>;

  const { inicio, fim } = calcularJanelaHorario(horariosAtendimento);
  const alturaGrid = (fim - inicio) * AGENDA_PX_POR_MINUTO;
  const horas = Array.from({ length: Math.floor((fim - inicio) / 60) + 1 }, (_, index) => inicio + index * 60);
  const itensPosicionados = posicionarItensTimeline(agendamentos);
  const mostrarLinhaAgora = diaSelecionado === dataLocalISO() && minutosAgora() >= inicio && minutosAgora() <= fim;
  const minutosAtual = minutosAgora();

  return (
    <div className="agenda-grid" style={{ height: alturaGrid }}>
      <div className="agenda-grid-hours" aria-hidden="true">
        {horas.map((minuto) => (
          <span className="agenda-grid-hour-label" key={minuto} style={{ top: (minuto - inicio) * AGENDA_PX_POR_MINUTO }}>
            {formatarHoraMinutos(minuto)}
          </span>
        ))}
      </div>
      <div className="agenda-grid-body">
        {horas.map((minuto) => (
          <span className="agenda-grid-line" key={minuto} style={{ top: (minuto - inicio) * AGENDA_PX_POR_MINUTO }} />
        ))}
        {mostrarLinhaAgora && (
          <div className="agenda-grid-now-line" style={{ top: (minutosAtual - inicio) * AGENDA_PX_POR_MINUTO }}>
            <span className="agenda-grid-now-dot" />
          </div>
        )}
        {itensPosicionados.map(({ agendamento, inicioMin, duracaoMin, coluna, totalColunas }) => {
          const cliente = firstRelation(agendamento.clientes);
          const servico = firstRelation(agendamento.servicos);
          const profissional = firstRelation(agendamento.profissionais);
          const statusLower = agendamento.status.toLowerCase();
          const finalizado = statusLower === "finalizado";
          const top = Math.max(0, (inicioMin - inicio) * AGENDA_PX_POR_MINUTO);
          const altura = Math.max(AGENDA_CARD_MIN_ALTURA, duracaoMin * AGENDA_PX_POR_MINUTO);
          const largura = 100 / totalColunas;
          const menuAberto = menuAbertoId === agendamento.id;

          return (
            <article
              className={`agenda-grid-card status-${statusLower} ${finalizado ? "is-finalizado" : ""} ${menuAberto ? "is-open" : ""}`}
              key={agendamento.id}
              onClick={() => {
                if (!finalizado) onFinish?.(agendamento);
              }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !finalizado) {
                  event.preventDefault();
                  onFinish?.(agendamento);
                }
              }}
              role={onFinish && !finalizado ? "button" : undefined}
              style={{ height: altura, left: `${coluna * largura}%`, top, width: `calc(${largura}% - 6px)` }}
              tabIndex={onFinish && !finalizado ? 0 : undefined}
              title={agendamento.status}
            >
              <div className="agenda-grid-card-time-row">
                {formatarHoraMinutos(inicioMin)} - {formatarHoraMinutos(inicioMin + duracaoMin)}
                <span className={`agenda-grid-card-status status-${statusLower}`}>{agendamento.status}</span>
              </div>
              <div className="agenda-grid-card-header">
                <strong>{cliente?.nome || "Cliente"}</strong>
              </div>
              <div className="agenda-grid-card-service-row">
                <span className="agenda-grid-card-service">{servico?.nome || "Servico"}</span>
                {servico?.preco != null && (
                  <span className="agenda-grid-card-price">
                    {formatarMoeda(obterPrecoServicoNoDia(servico, agendamento.data_agendamento))}
                  </span>
                )}
              </div>
              <span className="agenda-grid-card-professional">{profissional?.nome || "Sem profissional"}</span>
              <div className="agenda-grid-card-actions">
                {onNotify && !finalizado && (
                  <button aria-label="Enviar lembrete" className="agenda-grid-icon-button" onClick={(event) => { event.stopPropagation(); onNotify(agendamento); }} type="button">
                    Lembrete
                  </button>
                )}
                <button
                  aria-label="Mais opcoes"
                  className="agenda-grid-icon-button"
                  onClick={(event) => { event.stopPropagation(); setMenuAbertoId(menuAberto ? null : agendamento.id); }}
                  type="button"
                >
                  Mais
                </button>
              </div>
              {menuAberto && (
                <div className="agenda-grid-card-menu" onClick={(event) => event.stopPropagation()}>
                  {onAssignProfissional && profissionais && profissionais.length > 0 && (
                    <label className="appointment-profissional-select">
                      Profissional
                      <select
                        onChange={(event) => onAssignProfissional(agendamento, event.target.value ? Number(event.target.value) : null)}
                        value={agendamento.profissional_id || ""}
                      >
                        <option value="">Sem profissional</option>
                        {profissionais.filter((p) => p.ativo !== false).map((p) => (
                          <option key={p.id} value={p.id}>{p.nome}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {onFinish && !finalizado && (
                    <button className="admin-pill-button primary" onClick={(event) => { event.stopPropagation(); setMenuAbertoId(null); onFinish(agendamento); }} type="button">
                      Finalizar
                    </button>
                  )}
                  {onCancel && !finalizado && (
                    <button className="admin-pill-button cancel-appt-btn" onClick={(event) => { event.stopPropagation(); setMenuAbertoId(null); onCancel(agendamento); }} type="button">
                      Cancelar
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TodayReminderPanel({
  agendamentos,
  onNotify,
  onSendAll,
}: {
  agendamentos: Agendamento[];
  onNotify: (agendamento: Agendamento) => void | Promise<void>;
  onSendAll: () => void | Promise<void>;
}) {
  const pendentes = agendamentos.filter((agendamento) => {
    const cliente = firstRelation(agendamento.clientes);
    return cliente?.telefone && !agendamento.lembrete_enviado_em;
  });
  const enviados = agendamentos.filter((agendamento) => Boolean(agendamento.lembrete_enviado_em));
  const semTelefone = agendamentos.filter((agendamento) => {
    const cliente = firstRelation(agendamento.clientes);
    return !cliente?.telefone;
  });

  return (
    <article className="reminder-panel">
      <div className="reminder-header">
        <div>
          <span>Lembretes de hoje</span>
          <h2>{pendentes.length > 0 ? `${pendentes.length} para enviar` : "Tudo em dia"}</h2>
          <p>Abra o WhatsApp com a mensagem pronta e marque cada cliente como lembrado.</p>
        </div>
        <button className="admin-pill-button primary" disabled={pendentes.length === 0} onClick={onSendAll} type="button">
          Enviar lembretes do dia
        </button>
      </div>

      <div className="reminder-summary" aria-label="Resumo de lembretes">
        <span>{pendentes.length} pendentes</span>
        <span>{enviados.length} enviados</span>
        <span>{semTelefone.length} sem telefone</span>
      </div>

      {agendamentos.length === 0 ? (
        <div className="empty-state">Nenhum cliente agendado para hoje.</div>
      ) : (
        <div className="reminder-list">
          {agendamentos.map((agendamento) => {
            const cliente = firstRelation(agendamento.clientes);
            const servico = firstRelation(agendamento.servicos);
            const enviado = Boolean(agendamento.lembrete_enviado_em);
            const horario = new Date(agendamento.data_agendamento).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <section className="reminder-row" key={agendamento.id}>
                <div>
                  <strong>{cliente?.nome || "Cliente"}</strong>
                  <span>
                    {horario} - {servico?.nome || "Servico"}
                  </span>
                </div>
                <em className={enviado ? "sent" : ""}>{enviado ? "Enviado" : "Pendente"}</em>
                <button
                  className="row-icon-button"
                  disabled={enviado || !cliente?.telefone}
                  onClick={() => onNotify(agendamento)}
                  type="button"
                >
                  {cliente?.telefone ? "Enviar" : "Sem WhatsApp"}
                </button>
              </section>
            );
          })}
        </div>
      )}
    </article>
  );
}

function MetricCard({
  accent,
  helper,
  label,
  value,
}: {
  accent?: boolean;
  helper: string;
  label: string;
  value: number | string;
}) {
  return (
    <article className={`metric-card admin-metric-card${accent ? " accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function AppointmentList({
  agendamentos,
  emptyLabel = "Nenhum agendamento ativo por enquanto.",
  onCancel,
  onFinish,
  onNotify,
  variant = "active",
}: {
  agendamentos: Agendamento[];
  emptyLabel?: string;
  onCancel?: (agendamento: Agendamento) => void | Promise<void>;
  onFinish?: (agendamento: Agendamento) => void;
  onNotify?: (agendamento: Agendamento) => void | Promise<void>;
  variant?: "active" | "history";
}) {
  if (agendamentos.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="appointment-card-list">
      {agendamentos.map((agendamento) => {
        const cliente = firstRelation(agendamento.clientes);
        const servico = firstRelation(agendamento.servicos);
        const profissional = firstRelation(agendamento.profissionais);

        return (
          <article className={`admin-appointment-card ${variant === "history" ? "is-history" : ""}`} key={agendamento.id}>
            <div className="appointment-card-person">
              <strong>{cliente?.nome || "Cliente"}</strong>
              <span>{formatarTelefone(cliente?.telefone || null)}</span>
            </div>
            <dl>
              <div>
                <dt>Servico</dt>
                <dd>{servico?.nome || "Servico"}</dd>
              </div>
              <div>
                <dt>Horario</dt>
                <dd className="appointment-card-time">{new Date(agendamento.data_agendamento).toLocaleString("pt-BR")}</dd>
              </div>
              {profissional && (
                <div>
                  <dt>Profissional</dt>
                  <dd>{profissional.nome}</dd>
                </div>
              )}
              <div>
                <dt>Status</dt>
                <dd className={`appointment-status-chip status-${agendamento.status.toLowerCase()}`}>{agendamento.status}</dd>
              </div>
            </dl>
            {variant === "active" && (
              <div className="appointment-actions">
                {onNotify && agendamento.status.toLowerCase() !== "finalizado" && (
                  <button className="admin-pill-button secondary" onClick={() => onNotify(agendamento)} type="button">
                    Enviar lembrete
                  </button>
                )}
                {onFinish && agendamento.status !== "finalizado" && (
                  <button className="admin-pill-button primary" onClick={() => onFinish(agendamento)} type="button">
                    Finalizar
                  </button>
                )}
                {onCancel && agendamento.status !== "finalizado" && (
                  <button className="admin-pill-button cancel-appt-btn" onClick={() => onCancel(agendamento)} type="button">
                    Cancelar
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function RevenueBarChart({ dias }: { dias: { dia: number; valor: number }[] }) {
  const hojeDia = new Date().getDate();
  const diasComMovimento = dias.filter((item) => item.dia <= hojeDia);
  const maiorValor = Math.max(...diasComMovimento.map((item) => item.valor), 1);

  return (
    <article className="finance-chart-card revenue-bar-chart">
      <div>
        <span>Faturamento por dia (mes atual)</span>
      </div>
      <div className="revenue-bar-chart-bars">
        {diasComMovimento.map((item) => (
          <div className="revenue-bar-chart-col" key={item.dia}>
            <div className="revenue-bar-chart-track">
              <span
                className={item.valor > 0 ? "revenue-bar-chart-fill" : "revenue-bar-chart-fill empty"}
                style={{ height: `${Math.max(item.valor > 0 ? 6 : 2, (item.valor / maiorValor) * 100)}%` }}
              />
            </div>
            <small>{String(item.dia).padStart(2, "0")}</small>
          </div>
        ))}
      </div>
      {diasComMovimento.length > 9 && (
        <p className="scroll-hint">
          Arraste para o lado para ver mais <span aria-hidden="true">→</span>
        </p>
      )}
    </article>
  );
}

function ServiceTilesRow({ items, total }: { items: RankingItem[]; total: number }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <article className="finance-chart-card service-tiles-row">
      <div>
        <span>Servicos realizados</span>
      </div>
      <div className="service-tiles-bars">
        {items.map((item) => (
          <div className="service-tile" key={item.nome}>
            <div className="service-tile-top">
              <strong>{item.total}</strong>
              {total > 0 && <em>{Math.round((item.total / total) * 100)}%</em>}
            </div>
            <span>{item.nome}</span>
          </div>
        ))}
      </div>
      {items.length > 3 && (
        <p className="scroll-hint">
          Arraste para o lado para ver mais <span aria-hidden="true">→</span>
        </p>
      )}
    </article>
  );
}

function HoursDistributionBar({
  dados,
}: {
  dados: { fechadoHoras: number; ociosoHoras: number; totalHoras: number; trabalhadasHoras: number };
}) {
  const total = dados.totalHoras || 1;
  const formatarHoras = (valor: number) => `${Math.round(valor)} hrs`;

  return (
    <article className="finance-chart-card hours-distribution">
      <div>
        <span>Distribuicao de horas</span>
        <strong>{formatarHoras(dados.totalHoras)} disponiveis</strong>
      </div>
      <div className="hours-distribution-track">
        <span className="hours-segment trabalhadas" style={{ width: `${(dados.trabalhadasHoras / total) * 100}%` }} />
        <span className="hours-segment ocioso" style={{ width: `${(dados.ociosoHoras / total) * 100}%` }} />
        <span className="hours-segment fechado" style={{ width: `${(dados.fechadoHoras / total) * 100}%` }} />
      </div>
      <div className="hours-distribution-legend">
        <span><em className="dot trabalhadas" />Trabalhadas · {formatarHoras(dados.trabalhadasHoras)}</span>
        <span><em className="dot ocioso" />Ocioso · {formatarHoras(dados.ociosoHoras)}</span>
        <span><em className="dot fechado" />Fechada · {formatarHoras(dados.fechadoHoras)}</span>
      </div>
    </article>
  );
}

function PaymentChart({ items, total }: { items: PaymentItem[]; total: number }) {
  const maiorValor = Math.max(...items.map((item) => item.valor), 1);

  return (
    <article className="finance-chart-card">
      <div>
        <span>Formas de pagamento</span>
        <strong>{formatarMoeda(total)}</strong>
      </div>

      {items.length === 0 ? (
        <p className="finance-empty">Nenhuma venda no periodo.</p>
      ) : (
        <div className="payment-bars">
          {items.map((item) => (
            <div className="payment-bar-row" key={item.nome}>
              <span>
                {item.nome}
                <em className="payment-bar-percent">{total > 0 ? Math.round((item.valor / total) * 100) : 0}%</em>
              </span>
              <div>
                <em style={{ width: `${Math.max(8, (item.valor / maiorValor) * 100)}%` }} />
              </div>
              <strong>{formatarMoeda(item.valor)}</strong>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function FinanceRankingCard({ items, title }: { items: RankingItem[]; title: string }) {
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const visiveis = mostrarTodos ? items : items.slice(0, 3);

  return (
    <article className="finance-list-card">
      <div className="finance-card-header">
        <h2>{title}</h2>
        <span>Top {Math.min(items.length, 3)}</span>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">Ainda nao ha dados neste periodo.</div>
      ) : (
        <div className="finance-ranking-list">
          {visiveis.map((item, index) => (
            <div className="finance-ranking-row" key={item.nome}>
              <em>{index + 1}</em>
              <span>{item.nome}</span>
              <strong>{item.total}</strong>
            </div>
          ))}
        </div>
      )}

      {items.length > 3 && (
        <button className="manager-more-button" onClick={() => setMostrarTodos((valor) => !valor)} type="button">
          {mostrarTodos ? "Ver menos" : "Ver mais"}
        </button>
      )}
    </article>
  );
}

function FinanceProductCard({ emptyLabel, produtos, title, useModal }: { emptyLabel: string; produtos: Produto[]; title: string; useModal?: boolean }) {
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const visiveis = produtos.slice(0, 3);

  return (
    <>
      <article className="finance-list-card">
        <div className="finance-card-header">
          <h2>{title}</h2>
          <span>{produtos.length} itens</span>
        </div>

        {produtos.length === 0 ? (
          <div className="empty-state">{emptyLabel}</div>
        ) : (
          <div className="finance-product-list">
            {(useModal ? visiveis : (mostrarTodos ? produtos : visiveis)).map((produto) => (
              <div className="finance-product-row" key={produto.id}>
                <ProductPhoto produto={produto} />
                <span>
                  <strong>{produto.nome}</strong>
                  <small>{formatarMoeda(produto.preco || 0)}</small>
                </span>
                <em>{produto.estoque || 0} un.</em>
              </div>
            ))}
          </div>
        )}

        {produtos.length > 3 && (
          useModal ? (
            <button className="manager-more-button" onClick={() => setModalAberto(true)} type="button">
              Ver todos ({produtos.length})
            </button>
          ) : (
            <button className="manager-more-button" onClick={() => setMostrarTodos((v) => !v)} type="button">
              {mostrarTodos ? "Ver menos" : "Ver mais"}
            </button>
          )
        )}
      </article>

      {modalAberto && (
        <div className="finance-modal-overlay" onClick={() => setModalAberto(false)}>
          <div className="finance-modal" onClick={(e) => e.stopPropagation()}>
            <div className="finance-modal-header">
              <strong>{title}</strong>
              <button aria-label="Fechar" onClick={() => setModalAberto(false)} type="button">×</button>
            </div>
            <div className="finance-modal-list">
              {produtos.map((produto) => (
                <div className="finance-product-row" key={produto.id}>
                  <ProductPhoto produto={produto} />
                  <span>
                    <strong>{produto.nome}</strong>
                    <small>{formatarMoeda(produto.preco || 0)}</small>
                  </span>
                  <em>{produto.estoque || 0} un.</em>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SaleModal({
  agendamento,
  aviso,
  finalizando,
  formaPagamento,
  itensVenda,
  onCancel,
  onClose,
  onConfirm,
  onNotify,
  produtos,
  setFormaPagamento,
  setItensVenda,
  total,
}: {
  agendamento: Agendamento;
  aviso: string;
  finalizando: boolean;
  formaPagamento: string;
  itensVenda: Record<number, string>;
  onCancel: () => void | Promise<void>;
  onClose: () => void;
  onConfirm: () => void;
  onNotify: () => void | Promise<void>;
  produtos: Produto[];
  setFormaPagamento: (forma: string) => void;
  setItensVenda: Dispatch<SetStateAction<Record<number, string>>>;
  total: number;
}) {
  const cliente = firstRelation(agendamento.clientes);
  const servico = firstRelation(agendamento.servicos);
  const statusLower = agendamento.status.toLowerCase();
  const inicioMin = minutosDoAgendamento(agendamento.data_agendamento);
  const duracaoMin = servico?.duracao && servico.duracao > 0 ? servico.duracao : AGENDA_DURACAO_PADRAO_MIN;
  const dataFormatada = new Date(agendamento.data_agendamento).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
    weekday: "short",
  });

  return (
    <section className="sale-modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalhe do atendimento">
      <article className="sale-modal">
        <div className="sale-modal-topbar">
          <button aria-label="Fechar" className="sale-modal-close" onClick={onClose} type="button">
            ✕
          </button>
          <button className="sale-modal-notify" onClick={onNotify} type="button">
            🔔 Lembrete
          </button>
        </div>

        <div className="sale-modal-datetime">
          <strong>{dataFormatada}</strong>
          <span>
            {formatarHoraMinutos(inicioMin)} às {formatarHoraMinutos(inicioMin + duracaoMin)}
          </span>
        </div>

        <div className="sale-modal-client">
          <div>
            <span className="sale-modal-label">Cliente</span>
            <h2>{cliente?.nome || "Cliente"}</h2>
            <span className="sale-modal-phone">{formatarTelefone(cliente?.telefone || null)}</span>
          </div>
          <span className={`sale-modal-status status-${statusLower}`}>{agendamento.status}</span>
        </div>

        <div className="sale-modal-section">
          <span className="sale-modal-label">Serviço(s)</span>
          <div className="sale-modal-chips">
            <span className="sale-modal-chip">
              {servico?.nome || "Servico"}
              <em>{formatarMoeda(obterPrecoServicoNoDia(servico, agendamento.data_agendamento))}</em>
            </span>
          </div>
        </div>

        <div className="sale-modal-section">
          <span className="sale-modal-label">Produto(s)</span>
          {produtos.length === 0 ? (
            <p className="sale-modal-empty">Nenhum produto cadastrado.</p>
          ) : (
            <div className="sale-modal-products">
              {produtos.map((produto) => (
                <label className="sale-modal-product-row" key={produto.id}>
                  <ProductPhoto produto={produto} />
                  <span>
                    <strong>{produto.nome}</strong>
                    <small>
                      {formatarMoeda(produto.preco || 0)} · estoque {produto.estoque || 0}
                    </small>
                  </span>
                  <input
                    className="sale-modal-qty-input"
                    min="0"
                    onChange={(event) =>
                      setItensVenda((atual) => ({
                        ...atual,
                        [produto.id]: event.target.value,
                      }))
                    }
                    placeholder="0"
                    type="number"
                    value={itensVenda[produto.id] || ""}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="sale-modal-total">
          <span>Total do atendimento</span>
          <strong>{formatarMoeda(total)}</strong>
        </div>

        {/* Controle funcional minimo; o visual sera ajustado depois. */}
        <div className="sale-modal-section">
          <label>
            <span className="sale-modal-label">Forma de pagamento</span>
            <select onChange={(event) => setFormaPagamento(event.target.value)} required value={formaPagamento}>
              <option value="">Selecione</option>
              {FORMAS_PAGAMENTO.map((forma) => (
                <option key={forma} value={forma}>
                  {forma}
                </option>
              ))}
            </select>
          </label>
        </div>

        {aviso && (
          <p className="notice notice-error" role="alert">
            {aviso}
          </p>
        )}

        <button className="sale-modal-confirm" disabled={finalizando} onClick={onConfirm} type="button">
          {finalizando ? "Finalizando..." : "Finalizar e lançar financeiro"}
        </button>
        <button className="sale-modal-cancel" onClick={onCancel} type="button">
          Cancelar agendamento
        </button>
      </article>
    </section>
  );
}

function ProductPhoto({ produto }: { produto: Produto }) {
  return (
    <span
      aria-hidden="true"
      className={produto.foto_url ? "product-photo with-image" : "product-photo"}
      style={produto.foto_url ? { backgroundImage: `url(${produto.foto_url})` } : undefined}
    >
      {!produto.foto_url && produto.nome.slice(0, 2)}
    </span>
  );
}

function formatarAniversario(data?: string | null) {
  if (!data) return "Sem data";

  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

function formatarTelefone(telefone: string | null) {
  if (!telefone) return "Telefone nao informado";
  const digits = telefone.replace(/\D/g, "");
  const sem55 = digits.startsWith("55") ? digits.slice(2) : digits;
  if (sem55.length === 11) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 7)}-${sem55.slice(7)}`;
  if (sem55.length === 10) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 6)}-${sem55.slice(6)}`;
  return sem55;
}

function formatarMoeda(valor: number) {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(valor);
}

function obterPrecoServicoNoDia(servico: ServicoResumo | Servico | null | undefined, dataIso: string) {
  const precoBase = servico?.preco || 0;
  if (!servico?.precos_por_dia) return precoBase;
  const dia = new Date(dataIso).getDay();
  const override = servico.precos_por_dia[String(dia)];
  return typeof override === "number" && override > 0 ? override : precoBase;
}

function agruparVendasPorDiaDoMes(vendas: Venda[]) {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const totaisPorDia = new Array(ultimoDia).fill(0);

  vendas.forEach((venda) => {
    const data = new Date(venda.created_at);
    if (data.getFullYear() === ano && data.getMonth() === mes) {
      totaisPorDia[data.getDate() - 1] += venda.total || 0;
    }
  });

  return totaisPorDia.map((valor, index) => ({ dia: index + 1, valor }));
}

function calcularResumoFinanceiro(
  vendas: Venda[],
  agendamentos: Agendamento[],
  produtos: Produto[],
  intervalo: IntervaloFinanceiro,
  horariosAtendimento?: string[] | null,
  diasAtendimento?: number[] | null,
) {
  const produtoTotais = new Map<string, number>();
  const servicoTotais = new Map<string, number>();
  const produtosComGiro = new Set<number>();

  vendas.forEach((venda) => {
    venda.venda_itens?.forEach((item) => {
      const produto = firstRelation(item.produtos);
      if (!produto?.nome) return;
      produtoTotais.set(produto.nome, (produtoTotais.get(produto.nome) || 0) + item.quantidade);
      if (item.produto_id) produtosComGiro.add(item.produto_id);
    });

    const agendamento = firstRelation(venda.agendamentos);
    const servico = firstRelation(agendamento?.servicos || null);
    if (servico?.nome) {
      servicoTotais.set(servico.nome, (servicoTotais.get(servico.nome) || 0) + 1);
    }
  });

  if (servicoTotais.size === 0) {
    filtrarAgendamentosPorIntervalo(agendamentos, intervalo)
      .filter((agendamento) => agendamento.status === "finalizado")
      .forEach((agendamento) => {
        const servico = firstRelation(agendamento.servicos);
        if (!servico?.nome) return;
        servicoTotais.set(servico.nome, (servicoTotais.get(servico.nome) || 0) + 1);
      });
  }

  const clientePorAgendamento = new Map<number, number>();
  agendamentos.forEach((agendamento) => {
    if (agendamento.cliente_id) clientePorAgendamento.set(agendamento.id, agendamento.cliente_id);
  });
  const clientesUnicosSet = new Set<number>();
  vendas.forEach((venda) => {
    const clienteId = venda.agendamento_id ? clientePorAgendamento.get(venda.agendamento_id) : undefined;
    if (clienteId) clientesUnicosSet.add(clienteId);
  });

  const totalReceita = vendas.reduce((total, venda) => total + (venda.total || 0), 0);
  const totalServicosRealizados = Array.from(servicoTotais.values()).reduce((total, valor) => total + valor, 0);

  const diasNoPeriodo = intervalo.dias;
  const slotsPorDia = horariosAtendimento?.length || HORARIOS_ATENDIMENTO_PADRAO.length;
  const agendamentosAtivosNoPeriodo = filtrarAgendamentosPorIntervalo(agendamentos, intervalo).filter(
    (agendamento) => agendamento.status.toLowerCase() !== "cancelado",
  );
  const taxaOcupacao =
    diasNoPeriodo && slotsPorDia > 0
      ? Math.round((agendamentosAtivosNoPeriodo.length / (diasNoPeriodo * slotsPorDia)) * 100)
      : null;

  const { inicio: aberturaMin, fim: fechamentoMin } = calcularJanelaHorario(horariosAtendimento);
  const minutosPorDiaAberto = fechamentoMin - aberturaMin;
  const diasAbertosNoPeriodo = contarDiasAbertosNoIntervalo(
    intervalo,
    diasAtendimento?.length ? diasAtendimento : DIAS_ATENDIMENTO_PADRAO,
  );
  const minutosTrabalhados = agendamentosAtivosNoPeriodo.reduce((total, agendamento) => {
    const servico = firstRelation(agendamento.servicos);
    return total + (servico?.duracao && servico.duracao > 0 ? servico.duracao : AGENDA_DURACAO_PADRAO_MIN);
  }, 0);
  const distribuicaoHoras =
    diasNoPeriodo && diasAbertosNoPeriodo !== null
      ? (() => {
          const minutosDisponiveis = diasAbertosNoPeriodo * minutosPorDiaAberto;
          const minutosOciosos = Math.max(0, minutosDisponiveis - minutosTrabalhados);
          const minutosFechado = Math.max(0, diasNoPeriodo * 24 * 60 - minutosDisponiveis);
          return {
            fechadoHoras: minutosFechado / 60,
            ociosoHoras: minutosOciosos / 60,
            totalHoras: (minutosDisponiveis + minutosFechado) / 60,
            trabalhadasHoras: minutosTrabalhados / 60,
          };
        })()
      : null;

  const atendimentosPorCliente = clientesUnicosSet.size > 0 ? vendas.length / clientesUnicosSet.size : 0;
  const receitaPorHora = minutosTrabalhados > 0 ? totalReceita / (minutosTrabalhados / 60) : 0;
  const rankingServicos = ordenarRanking(servicoTotais);
  const topServico =
    rankingServicos.length > 0 && totalServicosRealizados > 0
      ? { nome: rankingServicos[0].nome, percentual: Math.round((rankingServicos[0].total / totalServicosRealizados) * 100) }
      : null;

  return {
    atendimentosPorCliente,
    clientesUnicos: clientesUnicosSet.size,
    distribuicaoHoras,
    estoqueBaixo: produtos.filter((produto) => (produto.estoque || 0) <= 2),
    formasPagamento: resumirFormasPagamento(vendas),
    pendencias: calcularPendencias(filtrarAgendamentosPorIntervalo(agendamentos, intervalo)),
    produtosMaisVendidos: ordenarRanking(produtoTotais),
    produtosSemGiro: produtos.filter((produto) => !produtosComGiro.has(produto.id)),
    receitaPorHora,
    servicosMaisVendidos: rankingServicos,
    taxaOcupacao,
    topServico,
    totalServicosRealizados,
    ticketMedio: vendas.length > 0 ? totalReceita / vendas.length : 0,
    totalReceita,
    upsellProduto: calcularUpsellProduto(vendas),
  };
}

function ordenarRanking(totais: Map<string, number>) {
  return Array.from(totais.entries())
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

function EditableServicoList({
  onDelete,
  onSave,
  servicos,
  setServicos,
}: {
  onDelete?: (id: number) => Promise<void>;
  onSave: (servico: Servico) => Promise<void>;
  servicos: Servico[];
  setServicos: Dispatch<SetStateAction<Servico[]>>;
}) {
  const [busca, setBusca] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [limite, setLimite] = useState(6);
  const servicosFiltrados = servicos.filter((servico) => normalizarBusca(servico.nome).includes(normalizarBusca(busca)));
  const servicosVisiveis = servicosFiltrados.slice(0, limite);

  if (servicos.length === 0) {
    return <div className="empty-state">Nenhum servico cadastrado ainda.</div>;
  }

  return (
    <div className="compact-manager">
      <input
        className="manager-search"
        onChange={(event) => {
          setBusca(event.target.value);
          setLimite(6);
        }}
        placeholder="Buscar servico"
        value={busca}
      />
      <div className="compact-list">
        {servicosVisiveis.map((servico) => {
          const editando = editandoId === servico.id;

          return (
            <article className="compact-row service-row" key={servico.id}>
              <span className="drag-dots" aria-hidden="true">
                ⋮
              </span>
              {servico.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="compact-row-photo" src={servico.foto_url} />
              ) : (
                <span className="compact-row-photo photo-placeholder" aria-hidden="true">
                  ✂
                </span>
              )}
              <div className="compact-row-main">
                <strong>{servico.nome}</strong>
                <span>
                  {servico.duracao || 30} min. - {formatarMoeda(servico.preco || 0)}
                </span>
              </div>
              <div className="compact-row-actions">
                <button
                  aria-label="Editar servico"
                  className="row-icon-button"
                  onClick={() => {
                    const abrir = !editando;
                    setEditandoId(abrir ? servico.id : null);
                    if (abrir) scrollParaPainelEdicao(`servico-edit-${servico.id}`);
                  }}
                  type="button"
                >
                  ✎
                </button>
                {onDelete && (
                  <button aria-label="Excluir servico" className="row-icon-button danger" onClick={() => onDelete(servico.id)} type="button">
                    🗑
                  </button>
                )}
              </div>

              {editando && (
                <div className="compact-edit-panel" id={`servico-edit-${servico.id}`}>
                  <div className="form-row-foto-nome">
                    <label className="item-foto-picker">
                      Foto
                      <input
                        accept="image/*"
                        className="item-foto-input"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            const dataUrl = await redimensionarFoto(file);
                            setServicos(
                              servicos.map((item) => (item.id === servico.id ? { ...item, foto_url: dataUrl } : item)),
                            );
                          }
                        }}
                        type="file"
                      />
                      {servico.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" src={servico.foto_url} />
                      ) : (
                        <span aria-hidden="true">📷</span>
                      )}
                    </label>
                    <label>
                      Nome
                      <input
                        onChange={(event) =>
                          setServicos(
                            servicos.map((item) => (item.id === servico.id ? { ...item, nome: event.target.value } : item)),
                          )
                        }
                        value={servico.nome}
                      />
                    </label>
                  </div>
                  <div className="form-row-2">
                    <label>
                      Duracao
                      <select
                        onChange={(event) =>
                          setServicos(
                            servicos.map((item) =>
                              item.id === servico.id ? { ...item, duracao: Number(event.target.value) } : item,
                            ),
                          )
                        }
                        value={servico.duracao || 30}
                      >
                        {Array.from(new Set([...DURACOES_SERVICO_OPCOES, servico.duracao || 30]))
                          .sort((a, b) => a - b)
                          .map((minutos) => (
                            <option key={minutos} value={minutos}>
                              {minutos} min
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Preco
                      <input
                        onChange={(event) =>
                          setServicos(
                            servicos.map((item) =>
                              item.id === servico.id ? { ...item, preco: Number(event.target.value) } : item,
                            ),
                          )
                        }
                        type="number"
                        value={servico.preco}
                      />
                    </label>
                  </div>
                  <details className="precos-por-dia">
                    <summary>Modo avancado de valores</summary>
                    <p className="precos-por-dia-hint">
                      Defina um preco diferente para dias especificos. Deixe em branco para usar o preco base ({formatarMoeda(servico.preco || 0)}).
                    </p>
                    <div className="precos-por-dia-grid">
                      {DIAS_SEMANA_COMPLETOS.map(({ label, dow }) => (
                        <label key={label}>
                          {label}
                          <input
                            inputMode="decimal"
                            onChange={(event) => {
                              const valor = event.target.value;
                              setServicos(
                                servicos.map((item) => {
                                  if (item.id !== servico.id) return item;
                                  const atual = { ...(item.precos_por_dia || {}) };
                                  if (valor) {
                                    atual[String(dow)] = Number(valor);
                                  } else {
                                    delete atual[String(dow)];
                                  }
                                  return { ...item, precos_por_dia: atual };
                                }),
                              );
                            }}
                            placeholder="R$ 0,00"
                            type="number"
                            value={servico.precos_por_dia?.[String(dow)] ?? ""}
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                  <button className="admin-pill-button primary" onClick={async () => { await onSave(servico); setEditandoId(null); }} type="button">
                    Salvar servico
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {servicosFiltrados.length === 0 && <div className="empty-state">Nenhum servico encontrado.</div>}
      {servicosFiltrados.length > limite && (
        <button className="manager-more-button" onClick={() => setLimite((valor) => valor + 6)} type="button">
          Ver mais servicos
        </button>
      )}
    </div>
  );
}

function EditableProdutoList({
  onDelete,
  onSave,
  produtos,
  setProdutos,
}: {
  onDelete?: (id: number) => Promise<void>;
  onSave: (produto: Produto) => Promise<void>;
  produtos: Produto[];
  setProdutos: Dispatch<SetStateAction<Produto[]>>;
}) {
  const [busca, setBusca] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [limite, setLimite] = useState(6);
  const produtosFiltrados = produtos.filter((produto) => normalizarBusca(produto.nome).includes(normalizarBusca(busca)));
  const produtosVisiveis = produtosFiltrados.slice(0, limite);

  if (produtos.length === 0) {
    return <div className="empty-state">Nenhum produto cadastrado ainda.</div>;
  }

  return (
    <div className="compact-manager">
      <input
        className="manager-search"
        onChange={(event) => {
          setBusca(event.target.value);
          setLimite(6);
        }}
        placeholder="Buscar produto"
        value={busca}
      />
      <div className="compact-list">
        {produtosVisiveis.map((produto) => {
          const editando = editandoId === produto.id;

          return (
            <article className="compact-row product-row" key={produto.id}>
              <span className="drag-dots" aria-hidden="true">
                ⋮
              </span>
              {produto.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="compact-row-photo" src={produto.foto_url} />
              ) : (
                <span className="compact-row-photo photo-placeholder" aria-hidden="true">
                  ▣
                </span>
              )}
              <div className="compact-row-main">
                <strong>{produto.nome}</strong>
                <span>
                  {produto.estoque || 0} un. - {formatarMoeda(produto.preco || 0)}
                  {produto.preco_custo && produto.preco_custo > 0 && produto.preco ? (
                    <em className="produto-margem-chip">
                      {(((produto.preco - produto.preco_custo) / produto.preco_custo) * 100).toFixed(0)}% lucro
                    </em>
                  ) : null}
                </span>
              </div>
              <button
                aria-label="Editar produto"
                className="row-icon-button"
                onClick={() => {
                  const abrir = !editando;
                  setEditandoId(abrir ? produto.id : null);
                  if (abrir) scrollParaPainelEdicao(`produto-edit-${produto.id}`);
                }}
                type="button"
              >
                ✎
              </button>

              {editando && (
                <div className="compact-edit-panel" id={`produto-edit-${produto.id}`}>
                  <div className="form-row-foto-nome">
                    <label className="item-foto-picker">
                      Foto
                      <input
                        accept="image/*"
                        className="item-foto-input"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            const dataUrl = await redimensionarFoto(file);
                            setProdutos(produtos.map((item) => (item.id === produto.id ? { ...item, foto_url: dataUrl } : item)));
                          }
                        }}
                        type="file"
                      />
                      {produto.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" src={produto.foto_url} />
                      ) : (
                        <span aria-hidden="true">📷</span>
                      )}
                    </label>
                    <label>
                      Nome
                      <input
                        onChange={(event) =>
                          setProdutos(
                            produtos.map((item) => (item.id === produto.id ? { ...item, nome: event.target.value } : item)),
                          )
                        }
                        value={produto.nome}
                      />
                    </label>
                  </div>
                  <div className="form-row-4">
                    <label>
                      Venda
                      <input
                        onChange={(event) =>
                          setProdutos(
                            produtos.map((item) =>
                              item.id === produto.id ? { ...item, preco: Number(event.target.value) } : item,
                            ),
                          )
                        }
                        type="number"
                        value={produto.preco || 0}
                      />
                    </label>
                    <label>
                      Custo
                      <input
                        onChange={(event) =>
                          setProdutos(
                            produtos.map((item) =>
                              item.id === produto.id ? { ...item, preco_custo: Number(event.target.value) || null } : item,
                            ),
                          )
                        }
                        type="number"
                        value={produto.preco_custo || 0}
                      />
                    </label>
                    <label>
                      Estoque
                      <input
                        onChange={(event) =>
                          setProdutos(
                            produtos.map((item) =>
                              item.id === produto.id ? { ...item, estoque: Number(event.target.value) } : item,
                            ),
                          )
                        }
                        type="number"
                        value={produto.estoque || 0}
                      />
                    </label>
                    <label>
                      Comissao
                      <input
                        onChange={(event) =>
                          setProdutos(
                            produtos.map((item) =>
                              item.id === produto.id ? { ...item, comissao_percentual: Number(event.target.value) } : item,
                            ),
                          )
                        }
                        type="number"
                        value={produto.comissao_percentual || 0}
                      />
                    </label>
                  </div>
                  {produto.preco && produto.preco_custo && produto.preco_custo > 0 && (
                    <p className="produto-lucro-preview">
                      Margem: <strong>{(((produto.preco - produto.preco_custo) / produto.preco_custo) * 100).toFixed(1)}%</strong> de lucro
                    </p>
                  )}
                  <button className="admin-pill-button primary" onClick={async () => { await onSave(produto); setEditandoId(null); }} type="button">
                    Salvar produto
                  </button>
                  {onDelete && (
                    <button className="admin-pill-button cancel-appt-btn" onClick={async () => { await onDelete(produto.id); setEditandoId(null); }} type="button">
                      Excluir produto
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {produtosFiltrados.length === 0 && <div className="empty-state">Nenhum produto encontrado.</div>}
      {produtosFiltrados.length > limite && (
        <button className="manager-more-button" onClick={() => setLimite((valor) => valor + 6)} type="button">
          Ver mais produtos
        </button>
      )}
    </div>
  );
}

function EditableClienteList({
  clientes,
  onDelete,
  onSave,
  setClientes,
}: {
  clientes: ClienteResumo[];
  onDelete?: (id: number) => Promise<void>;
  onSave: (cliente: ClienteResumo) => Promise<void>;
  setClientes: Dispatch<SetStateAction<ClienteResumo[]>>;
}) {
  const [busca, setBusca] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [limite, setLimite] = useState(3);
  const termoBusca = normalizarBusca(busca);
  const clientesFiltrados = clientes.filter((cliente) => {
    return [cliente.nome, cliente.telefone || "", formatarAniversario(cliente.data_nascimento)]
      .map(normalizarBusca)
      .some((valor) => valor.includes(termoBusca));
  });
  const clientesVisiveis = clientesFiltrados.slice(0, limite);

  function atualizarClienteLocal(id: number, patch: Partial<ClienteResumo>) {
    setClientes((atuais) => atuais.map((cliente) => (cliente.id === id ? { ...cliente, ...patch } : cliente)));
  }

  if (clientes.length === 0) {
    return <div className="empty-state">Nenhum cliente cadastrado ainda.</div>;
  }

  return (
    <div className="client-manager">
      <input
        className="manager-search"
        onChange={(event) => {
          setBusca(event.target.value);
          setLimite(3);
        }}
        placeholder="Buscar por nome, WhatsApp ou aniversario"
        value={busca}
      />

      <div className="client-summary-grid">
        <span>{clientes.length} clientes</span>
        <span>{clientes.filter((cliente) => cliente.telefone).length} com WhatsApp</span>
        <span>{clientes.filter((cliente) => cliente.data_nascimento).length} aniversarios</span>
      </div>

      <div className="client-card-list">
        {clientesVisiveis.map((cliente) => {
          const editando = editandoId === cliente.id;

          return (
            <article className="client-card" key={cliente.id}>
              <div className="client-card-main">
                <strong>{cliente.nome}</strong>
                <span>{cliente.telefone || "WhatsApp nao informado"}</span>
                <small>Aniversario: {formatarAniversario(cliente.data_nascimento)}</small>
              </div>
              <div className="client-card-actions">
                {cliente.telefone && (
                  <a
                    aria-label="Conversar no WhatsApp"
                    className="client-card-icon-button"
                    href={`https://wa.me/55${cliente.telefone.replace(/\D/g, "")}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    💬
                  </a>
                )}
                <button
                  aria-label="Editar cliente"
                  className="client-card-icon-button"
                  onClick={() => setEditandoId(editando ? null : cliente.id)}
                  type="button"
                >
                  ✎
                </button>
              </div>

              {editando && (
                <div className="compact-edit-panel client-edit-panel">
                  <label>
                    Nome
                    <input
                      onChange={(event) => atualizarClienteLocal(cliente.id, { nome: event.target.value })}
                      value={cliente.nome}
                    />
                  </label>
                  <label>
                    WhatsApp com DDD
                    <input
                      inputMode="tel"
                      onChange={(event) => atualizarClienteLocal(cliente.id, { telefone: event.target.value })}
                      placeholder="18981518787"
                      value={cliente.telefone || ""}
                    />
                  </label>
                  <label>
                    Data de nascimento
                    <input
                      onChange={(event) => atualizarClienteLocal(cliente.id, { data_nascimento: event.target.value || null })}
                      type="date"
                      value={cliente.data_nascimento || ""}
                    />
                  </label>
                  <button className="admin-pill-button primary" onClick={async () => { await onSave(cliente); setEditandoId(null); }} type="button">
                    Salvar cliente
                  </button>
                  {onDelete && (
                    <button
                      className="admin-pill-button cancel-appt-btn"
                      onClick={async () => { await onDelete(cliente.id); setEditandoId(null); }}
                      type="button"
                    >
                      Excluir cliente
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {clientesFiltrados.length === 0 && <div className="empty-state">Nenhum cliente encontrado.</div>}
      {clientesFiltrados.length > limite && (
        <button className="manager-more-button" onClick={() => setLimite((valor) => valor + 3)} type="button">
          Ver mais clientes
        </button>
      )}
    </div>
  );
}

function redimensionarFoto(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 600;
        let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
        else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function normalizarBusca(valor: string) {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function RankingList({ items }: { items: RankingItem[] }) {
  if (items.length === 0) {
    return <div className="empty-state">Ainda nao ha agendamentos suficientes para ranking.</div>;
  }

  return (
    <div className="simple-list">
      {items.map((item, index) => (
        <div key={item.nome}>
          <strong>
            {index + 1}. {item.nome}
          </strong>
          <span>{item.total} agendamento(s)</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Historico por cliente ----------

function HistoricoClientePanel({
  agendamentos,
  clientes,
  vendas,
}: {
  agendamentos: Agendamento[];
  clientes: ClienteResumo[];
  vendas: Venda[];
}) {
  const [busca, setBusca] = useState("");
  const [clienteSelecionadoId, setClienteSelecionadoId] = useState<number | null>(null);

  const termoBusca = normalizarBusca(busca);
  const clientesFiltrados = busca
    ? clientes.filter((c) => normalizarBusca(c.nome).includes(termoBusca))
    : clientes;

  const clienteSelecionado = clientes.find((c) => c.id === clienteSelecionadoId) || null;

  const agendamentosCliente = agendamentos
    .filter((ag) => firstRelation(ag.clientes)?.id === clienteSelecionadoId)
    .sort((a, b) => b.data_agendamento.localeCompare(a.data_agendamento));

  const vendasCliente = vendas.filter((v) => {
    if (!v.agendamento_id) return false;
    return agendamentosCliente.some((ag) => ag.id === v.agendamento_id);
  });

  const totalGasto = vendasCliente.reduce((acc, v) => acc + (v.total || 0), 0);

  return (
    <div className="historico-cliente-panel">
      <div className="historico-busca-row">
        <input
          className="manager-search"
          onChange={(e) => {
            setBusca(e.target.value);
            setClienteSelecionadoId(null);
          }}
          placeholder="Buscar cliente pelo nome"
          value={busca}
        />
      </div>

      {!clienteSelecionado && busca && (
        <div className="historico-sugestoes">
          {clientesFiltrados.slice(0, 8).map((c) => (
            <button
              className="historico-sugestao-item"
              key={c.id}
              onClick={() => {
                setClienteSelecionadoId(c.id);
                setBusca(c.nome);
              }}
              type="button"
            >
              <span className="client-avatar" aria-hidden="true">{c.nome.slice(0, 2)}</span>
              {c.nome}
              {c.telefone && <small>{c.telefone}</small>}
            </button>
          ))}
          {clientesFiltrados.length === 0 && <div className="empty-state">Nenhum cliente encontrado.</div>}
        </div>
      )}

      {clienteSelecionado && (
        <div className="historico-detalhe">
          <div className="historico-cliente-header">
            <div className="client-avatar" aria-hidden="true">{clienteSelecionado.nome.slice(0, 2)}</div>
            <div>
              <strong>{clienteSelecionado.nome}</strong>
              <span>{clienteSelecionado.telefone || "Sem WhatsApp"}</span>
            </div>
            <div className="historico-totais">
              <span>{agendamentosCliente.length} visitas</span>
              <strong>{formatarMoeda(totalGasto)} gastos</strong>
            </div>
          </div>

          {agendamentosCliente.length === 0 ? (
            <div className="empty-state">Nenhum agendamento encontrado para este cliente.</div>
          ) : (
            <div className="historico-lista">
              {agendamentosCliente.map((ag) => {
                const servico = firstRelation(ag.servicos);
                const venda = vendasCliente.find((v) => v.agendamento_id === ag.id);
                const itens = venda?.venda_itens || [];
                return (
                  <article className="historico-item" key={ag.id}>
                    <div className="historico-item-data">
                      {new Date(ag.data_agendamento + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                    <div className="historico-item-corpo">
                      <strong>{servico?.nome || "Servico nao informado"}</strong>
                      {servico?.preco ? <span className="historico-valor">{formatarMoeda(servico.preco)}</span> : null}
                      {itens.length > 0 && (
                        <ul className="historico-produtos">
                          {itens.map((item, idx) => {
                            const nomeProd = (Array.isArray(item.produtos) ? item.produtos[0] : item.produtos)?.nome || "Produto";
                            return (
                              <li key={idx}>
                                {nomeProd} x{item.quantidade}
                                {item.valor_unitario ? <em> — {formatarMoeda(item.valor_unitario * item.quantidade)}</em> : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {venda?.total ? <span className="historico-total-venda">Total: {formatarMoeda(venda.total)}</span> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!busca && (
        <div className="empty-state">Digite o nome do cliente para ver o historico completo.</div>
      )}
    </div>
  );
}

// ---------- Ranking de clientes ----------

function RankingClientePanel({
  agendamentos,
  clientes,
}: {
  agendamentos: Agendamento[];
  clientes: ClienteResumo[];
}) {
  const hoje = new Date();
  const limite30 = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);

  const mapaClientes = new Map<number, { nome: string; telefone: string | null; total: number; ultimaVisita: Date }>();
  for (const ag of agendamentos) {
    const cliente = firstRelation(ag.clientes);
    if (!cliente) continue;
    const data = new Date(ag.data_agendamento + "T12:00:00");
    const atual = mapaClientes.get(cliente.id);
    if (!atual) {
      mapaClientes.set(cliente.id, { nome: cliente.nome, telefone: cliente.telefone, total: 1, ultimaVisita: data });
    } else {
      mapaClientes.set(cliente.id, {
        ...atual,
        total: atual.total + 1,
        ultimaVisita: data > atual.ultimaVisita ? data : atual.ultimaVisita,
      });
    }
  }

  for (const c of clientes) {
    if (!mapaClientes.has(c.id)) {
      mapaClientes.set(c.id, { nome: c.nome, telefone: c.telefone, total: 0, ultimaVisita: new Date(0) });
    }
  }

  const lista = Array.from(mapaClientes.values()).sort((a, b) => b.total - a.total);
  const inativos30 = lista.filter((c) => c.ultimaVisita < limite30);
  const top10 = lista.slice(0, 10);

  return (
    <div className="ranking-cliente-panel">
      {inativos30.length > 0 && (
        <div className="ranking-alerta-inativos">
          <div className="ranking-alerta-header">
            <span className="ranking-alerta-icon">⚠</span>
            <div>
              <strong>{inativos30.length} cliente{inativos30.length > 1 ? "s" : ""} sem visita ha mais de 30 dias</strong>
              <p>Considere mandar uma mensagem para traz-los de volta.</p>
            </div>
          </div>
          <div className="ranking-inativos-lista">
            {inativos30.map((c) => (
              <div className="ranking-inativo-item" key={c.nome}>
                <span className="client-avatar" aria-hidden="true">{c.nome.slice(0, 2)}</span>
                <div>
                  <strong>{c.nome}</strong>
                  <small>
                    {c.total === 0
                      ? "Nunca agendou"
                      : "Ultima visita: " + c.ultimaVisita.toLocaleDateString("pt-BR")}
                  </small>
                </div>
                {c.telefone && (
                  <a
                    className="admin-pill-button secondary"
                    href={"https://wa.me/55" + c.telefone.replace(/\D/g, "") + "?text=" + encodeURIComponent("Oi " + c.nome + "! Sentimos sua falta, que tal agendar um horario?")}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Whats
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <h3>Top clientes</h3>
      {top10.length === 0 ? (
        <div className="empty-state">Nenhum agendamento registrado ainda.</div>
      ) : (
        <div className="simple-list">
          {top10.map((item, index) => (
            <div key={item.nome}>
              <strong>{index + 1}. {item.nome}</strong>
              <span>
                {item.total} visita{item.total !== 1 ? "s" : ""}
                {item.total > 0 ? " — ultima: " + item.ultimaVisita.toLocaleDateString("pt-BR") : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Inteligencia / IA ----------

function InteligenciaListCard({ children, className, title }: { children: React.ReactNode; className: string; title: string }) {
  return (
    <article className={className}>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

type InteligenciaItem = {
  key: string;
  primary: string;
  secondary?: string;
  action?: React.ReactNode;
};

function InteligenciaVerMais({ items, title }: { items: InteligenciaItem[]; title: string }) {
  const [modalAberto, setModalAberto] = useState(false);
  const visiveis = items.slice(0, 3);

  return (
    <>
      <ul>
        {visiveis.map((item) => (
          <li key={item.key}>
            <strong>{item.primary}</strong>
            {item.secondary && <span>{item.secondary}</span>}
            {item.action}
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button className="manager-more-button" onClick={() => setModalAberto(true)} type="button">
          Ver todos ({items.length})
        </button>
      )}
      {modalAberto && (
        <div className="finance-modal-overlay" onClick={() => setModalAberto(false)}>
          <div className="finance-modal" onClick={(e) => e.stopPropagation()}>
            <div className="finance-modal-header">
              <strong>{title}</strong>
              <button aria-label="Fechar" onClick={() => setModalAberto(false)} type="button">×</button>
            </div>
            <div className="finance-modal-list">
              <ul className="inteligencia-modal-list">
                {items.map((item) => (
                  <li key={item.key}>
                    <strong>{item.primary}</strong>
                    {item.secondary && <span>{item.secondary}</span>}
                    {item.action}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InteligenciaPanel({
  agendamentos,
  clientes,
  dataFim,
  dataInicio,
  periodo,
  produtos,
  vendas,
}: {
  agendamentos: Agendamento[];
  clientes: ClienteResumo[];
  dataFim?: string;
  dataInicio?: string;
  periodo?: "7" | "30" | "custom";
  produtos: Produto[];
  vendas: Venda[];
}) {
  const hoje = new Date();
  const dias = periodo === "7" ? 7 : 30;

  let inicioPeriodo: Date;
  let fimPeriodo: Date = hoje;

  if (periodo === "custom" && dataInicio) {
    inicioPeriodo = new Date(dataInicio + "T00:00:00");
    if (dataFim) fimPeriodo = new Date(dataFim + "T23:59:59");
  } else {
    inicioPeriodo = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
  }

  const labelPeriodo = periodo === "custom" && dataInicio
    ? `${dataInicio} a ${dataFim || "hoje"}`
    : `${dias} dias`;

  const vendas30 = vendas.filter((v) => {
    const d = new Date(v.created_at);
    return d >= inicioPeriodo && d <= fimPeriodo;
  });
  const receita30 = vendas30.reduce((acc, v) => acc + (v.total || 0), 0);
  const inicio7 = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);
  const vendas7 = vendas.filter((v) => new Date(v.created_at) >= inicio7);
  const receita7 = vendas7.reduce((acc, v) => acc + (v.total || 0), 0);
  const ticketMedio = vendas30.length > 0 ? receita30 / vendas30.length : 0;

  const giroMap = new Map<number, number>();
  for (const v of vendas30) {
    for (const item of v.venda_itens || []) {
      if (item.produto_id) giroMap.set(item.produto_id, (giroMap.get(item.produto_id) || 0) + item.quantidade);
    }
  }

  const produtosBaixoGiro = produtos
    .filter((p) => (giroMap.get(p.id) || 0) < 2)
    .sort((a, b) => (giroMap.get(a.id) || 0) - (giroMap.get(b.id) || 0));

  const produtosMaisVendidos = [...produtos]
    .filter((p) => (giroMap.get(p.id) || 0) >= 2)
    .sort((a, b) => (giroMap.get(b.id) || 0) - (giroMap.get(a.id) || 0))
    .slice(0, 5);

  const ultimaVisitaMap = new Map<number, Date>();
  for (const ag of agendamentos) {
    const cliente = firstRelation(ag.clientes);
    if (!cliente) continue;
    const data = new Date(ag.data_agendamento + "T12:00:00");
    const atual = ultimaVisitaMap.get(cliente.id);
    if (!atual || data > atual) ultimaVisitaMap.set(cliente.id, data);
  }
  const clientesInativos = clientes.filter((c) => {
    const ultima = ultimaVisitaMap.get(c.id);
    return !ultima || ultima < inicioPeriodo;
  });

  const servicoGiro = new Map<string, number>();
  for (const ag of agendamentos.filter((a) => {
    const d = new Date(a.data_agendamento);
    return d >= inicioPeriodo && d <= fimPeriodo;
  })) {
    const s = firstRelation(ag.servicos);
    if (s?.nome) servicoGiro.set(s.nome, (servicoGiro.get(s.nome) || 0) + 1);
  }
  const topServicos = Array.from(servicoGiro.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="inteligencia-panel">
      <div className="inteligencia-grid">

        <article className="inteligencia-card">
          <h3>Receita — {labelPeriodo}</h3>
          <strong className="inteligencia-numero">{formatarMoeda(receita30)}</strong>
          {periodo !== "7" && <span>Ultimos 7 dias: {formatarMoeda(receita7)}</span>}
          <span>Ticket medio: {formatarMoeda(ticketMedio)}</span>
          <span>{vendas30.length} atendimento{vendas30.length !== 1 ? "s" : ""} no periodo</span>
        </article>

        <InteligenciaListCard className="inteligencia-card" title={`Servicos mais populares — ${labelPeriodo}`}>
          {topServicos.length === 0 ? (
            <span className="inteligencia-vazio">Sem dados suficientes</span>
          ) : (
            <InteligenciaVerMais
              items={topServicos.map(([nome, qtd]) => ({ key: nome, primary: nome, secondary: `${qtd}x` }))}
              title="Servicos mais populares"
            />
          )}
        </InteligenciaListCard>

        <InteligenciaListCard className="inteligencia-card destaque-alerta" title="Produtos com baixo giro">
          <p className="inteligencia-subtitulo">Menos de 2 unidades vendidas em 30 dias — considere fazer uma promocao.</p>
          {produtosBaixoGiro.length === 0 ? (
            <span className="inteligencia-vazio">Todos os produtos estao girando bem!</span>
          ) : (
            <InteligenciaVerMais
              items={produtosBaixoGiro.map((p) => ({ key: String(p.id), primary: p.nome, secondary: `${giroMap.get(p.id) || 0} vend. — estoque: ${p.estoque || 0}` }))}
              title="Produtos com baixo giro"
            />
          )}
        </InteligenciaListCard>

        <InteligenciaListCard className="inteligencia-card destaque-positivo" title="Sugestao de recompra">
          <p className="inteligencia-subtitulo">Produtos que mais saem — mantenha estoque em dia.</p>
          {produtosMaisVendidos.length === 0 ? (
            <span className="inteligencia-vazio">Sem dados de venda ainda.</span>
          ) : (
            <InteligenciaVerMais
              items={produtosMaisVendidos.map((p) => ({ key: String(p.id), primary: p.nome, secondary: `${giroMap.get(p.id)} vendidos — estoque: ${p.estoque || 0}` }))}
              title="Sugestao de recompra"
            />
          )}
        </InteligenciaListCard>

        <InteligenciaListCard className="inteligencia-card destaque-alerta" title="Clientes para reativar">
          <p className="inteligencia-subtitulo">{clientesInativos.length} clientes sem visita ha mais de {labelPeriodo}.</p>
          {clientesInativos.length === 0 ? (
            <span className="inteligencia-vazio">Nenhum cliente inativo!</span>
          ) : (
            <InteligenciaVerMais
              items={clientesInativos.map((c) => ({
                key: String(c.id),
                primary: c.nome,
                secondary: c.telefone ? "" : "Sem WhatsApp",
                action: c.telefone ? (
                  <a
                    className="inteligencia-whats-btn"
                    href={"https://wa.me/55" + c.telefone.replace(/\D/g, "") + "?text=" + encodeURIComponent("Oi " + c.nome + "! Que tal dar uma passada na barbearia?")}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Whats
                  </a>
                ) : undefined,
              }))}
              title="Clientes para reativar"
            />
          )}
        </InteligenciaListCard>

        {produtosBaixoGiro.length > 0 && (
          <InteligenciaListCard className="inteligencia-card destaque-sugestao" title="Sugestao de promocao">
            <InteligenciaVerMais
              items={produtosBaixoGiro.map((p) => ({
                key: String(p.id),
                primary: `Promocao de ${p.nome}`,
                secondary: p.preco_custo && p.preco
                  ? `Custo ${formatarMoeda(p.preco_custo)} — venda ${formatarMoeda(p.preco)}. Desconto de ate ${Math.floor(((p.preco - p.preco_custo) / p.preco) * 100)}%.`
                  : `Preco atual: ${formatarMoeda(p.preco || 0)}. Considere um desconto.`,
              }))}
              title="Sugestao de promocao"
            />
          </InteligenciaListCard>
        )}

      </div>
    </div>
  );
}

function AddFormSheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="add-sheet-backdrop" onClick={onClose}>
      <div className="add-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="add-sheet-header">
          <strong>{title}</strong>
          <button aria-label="Fechar" className="add-sheet-close" onClick={onClose} type="button">×</button>
        </div>
        <div className="add-sheet-body">
          {children}
        </div>
      </div>
    </div>
  );
}
