"use client";

import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
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
  nome: string;
  preco: number | null;
};

type Agendamento = {
  cliente_id: number | null;
  id: number;
  data_agendamento: string;
  lembrete_enviado_em?: string | null;
  lembrete_status?: string | null;
  servico_id: number | null;
  status: string;
  clientes: ClienteResumo | ClienteResumo[] | null;
  servicos: ServicoResumo | ServicoResumo[] | null;
};

type VendaItem = {
  produto_id: number | null;
  quantidade: number;
  valor_unitario: number | null;
  produtos: { nome: string } | { nome: string }[] | null;
};

type Venda = {
  agendamento_id: number | null;
  created_at: string;
  forma_pagamento?: string | null;
  id: number;
  total: number | null;
  agendamentos:
    | {
        data_agendamento: string;
        servicos: ServicoResumo | ServicoResumo[] | null;
      }
    | {
        data_agendamento: string;
        servicos: ServicoResumo | ServicoResumo[] | null;
      }[]
    | null;
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
type PeriodoFinanceiro = "hoje" | "7" | "30" | "todos";
type DiaPainel = {
  dia: string;
  iso: string;
  labelCompleto: string;
  semana: string;
};

const diasCurtos = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
const mesesCurtos = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS_ATENDIMENTO_PADRAO = [1, 2, 3, 4, 5, 6];
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

function montarDiasDoPainel() {
  const hoje = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + index);

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
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [produtoAviso, setProdutoAviso] = useState("");
  const [financeiroAviso, setFinanceiroAviso] = useState("");
  const [servicoForm, setServicoForm] = useState({ duracao: "30", nome: "", preco: "" });
  const [produtoForm, setProdutoForm] = useState({ comissao: "", custo: "", estoque: "0", foto_url: "", nome: "", preco: "" });
  const [abaClientes, setAbaClientes] = useState<AbaClientes>("cadastro");
  const [periodoFinanceiro, setPeriodoFinanceiro] = useState<PeriodoFinanceiro>("hoje");
  const [atendimentoAberto, setAtendimentoAberto] = useState<Agendamento | null>(null);
  const [itensVenda, setItensVenda] = useState<Record<number, string>>({});
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
  const [addServicoOpen, setAddServicoOpen] = useState(false);
  const [addProdutoOpen, setAddProdutoOpen] = useState(false);
  const [periodoInteligencia, setPeriodoInteligencia] = useState<"7" | "30" | "custom">("30");
  const [inteligenciaDataInicio, setInteligenciaDataInicio] = useState("");
  const [inteligenciaDataFim, setInteligenciaDataFim] = useState("");

  const empresaIdAtual = empresa?.id || EMPRESA_ID_LEGADO;
  const empresaSlugAtual = empresa?.slug?.trim();
  const linkPublico =
    typeof window === "undefined"
      ? `/agendamentos${empresaSlugAtual ? `?empresa=${empresaSlugAtual}` : ""}`
      : `${window.location.origin}/agendamentos${empresaSlugAtual ? `?empresa=${empresaSlugAtual}` : ""}`;
  const diasAgendaPainel = useMemo(() => montarDiasDoPainel(), []);

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

  const vendasFiltradas = useMemo(() => filtrarVendasPorPeriodo(vendas, periodoFinanceiro), [periodoFinanceiro, vendas]);
  const resumoFinanceiro = useMemo(
    () => calcularResumoFinanceiro(vendasFiltradas, agendamentos, produtos),
    [agendamentos, produtos, vendasFiltradas],
  );

  const totalAtendimentoAberto = useMemo(() => {
    if (!atendimentoAberto) return 0;

    const servico = firstRelation(atendimentoAberto.servicos);
    const totalServico = servico?.preco || 0;
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
    ] = await Promise.all([
      supabase.from("servicos").select("id,nome,preco,duracao").eq("empresa_id", empresaId).order("nome"),
      supabase
        .from("agendamentos")
        .select(
          "id,cliente_id,servico_id,data_agendamento,status,lembrete_enviado_em,lembrete_status,clientes(id,nome,telefone,data_nascimento),servicos(nome,preco)",
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
          "id,created_at,total,agendamento_id,agendamentos(data_agendamento,servicos(nome,preco)),venda_itens(produto_id,quantidade,valor_unitario,produtos(nome))",
        )
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false }),
      fetch(`/api/company-profile?empresaId=${empresaId}`, { cache: "no-store" })
        .then((response) => response.json())
        .catch(() => null),
    ]);

    setEmpresa(empresaAtual);
    setConfigDias(empresaAtual.dias_atendimento?.length ? empresaAtual.dias_atendimento : DIAS_ATENDIMENTO_PADRAO);
    setConfigHorarios(
      empresaAtual.horarios_atendimento?.length ? empresaAtual.horarios_atendimento : HORARIOS_ATENDIMENTO_PADRAO,
    );

    if (servicosResponse.data) setServicos(servicosResponse.data as Servico[]);
    if (agendamentosResponse.data) setAgendamentos(agendamentosResponse.data as unknown as Agendamento[]);
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
      nome: servicoForm.nome.trim(),
      preco: Number(servicoForm.preco),
    });
    setSalvandoServico(false);

    if (error) {
      setMensagem(`Erro ao cadastrar servico: ${formatarErroSupabase(error.message)}`);
      return;
    }

    setServicoForm({ duracao: "30", nome: "", preco: "" });
    setAddServicoOpen(false);
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
        nome: servico.nome,
        preco: servico.preco,
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

    const response = await fetch("/api/clientes", {
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

  async function enviarLembrete(agendamento: Agendamento) {
    const cliente = firstRelation(agendamento.clientes);
    const servico = firstRelation(agendamento.servicos);
    const telefoneLimpo = normalizarTelefoneBrasil(cliente?.telefone || "");

    if (!telefoneLimpo) {
      setMensagem("Este cliente nao informou WhatsApp no agendamento.");
      return;
    }

    const texto = encodeURIComponent(
      `Ola, ${cliente?.nome || "tudo bem"}! Passando para lembrar seu agendamento de ${servico?.nome || "servico"} em ${new Date(
        agendamento.data_agendamento,
      ).toLocaleString("pt-BR")}.`,
    );

    window.open(`https://wa.me/${telefoneLimpo}?text=${texto}`, "_blank", "noopener,noreferrer");
    const lembreteMarcado = await marcarLembreteEnviado(agendamento);

    if (lembreteMarcado) {
      setMensagem(`Lembrete de ${cliente?.nome || "cliente"} marcado como enviado.`);
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
    const response = await fetch("/api/schedule-config", {
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
    const response = await fetch("/api/company-profile", {
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
      .insert({
        agendamento_id: atendimentoAberto.id,
        empresa_id: empresaIdAtual,
        total: totalAtendimentoAberto,
      })
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

        {activeSection === "visao" && (
          <AdminSectionShell
            description="Acompanhe os numeros principais e o que precisa de atencao hoje."
            title="Visao geral"
          >
            <section className="admin-link-card">
              <div>
                <h2>Link publico para clientes</h2>
                <p>Envie este endereco no WhatsApp, Instagram ou Google Perfil da Empresa.</p>
              </div>
              <button className="admin-pill-button primary" onClick={copiarLink} type="button">
                Copiar link
              </button>
              <input readOnly value={linkPublico} />
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
          <section className="admin-section">
            <AgendaHero
              agendamentos={agendamentosAtivos}
              dias={diasAgendaPainel}
              empresa={empresa}
              nomeDono={nomeDono}
              onOpenMenu={() => setMobileDrawerOpen(true)}
              vendas={vendas}
            />
            <TodayReminderPanel
              agendamentos={lembretesDeHoje}
              onNotify={enviarLembrete}
              onSendAll={enviarLembretesDoDia}
            />
            <article className="admin-panel">
              <h2>Agenda do dia</h2>
              <AppointmentList
                agendamentos={lembretesDeHoje}
                emptyLabel="Nenhum agendamento ativo para hoje."
                onCancel={cancelarAgendamentoDono}
                onFinish={abrirFinalizacao}
                onNotify={enviarLembrete}
              />
            </article>

            <article className="admin-panel">
              <button
                className="collapsible-panel-trigger"
                onClick={() => setHistoricoAberto((aberto) => !aberto)}
                type="button"
              >
                <span>Historico de atendimentos</span>
                <strong>{historicoAgendamentos.length}</strong>
                <em>{historicoAberto ? "Ocultar" : "Ver historico"}</em>
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

        {activeSection === "servicos" && (
          <AdminSectionShell
            description="Cadastre os servicos que aparecem no link publico e edite valores ou duracao."
            title="Servicos"
          >
            <article className="admin-panel">
              <div className="panel-header-with-action">
                <h2>Servicos</h2>
                <button className="add-item-btn" onClick={() => setAddServicoOpen(true)} type="button">+ Novo</button>
              </div>
              <EditableServicoList servicos={servicos} setServicos={setServicos} onSave={atualizarServico} />
            </article>
          </AdminSectionShell>
        )}

        {addServicoOpen && (
          <AddFormSheet onClose={() => setAddServicoOpen(false)} title="Novo servico">
            <form className="form-stack add-sheet-form" onSubmit={cadastrarServico}>
              <label>
                Nome
                <input
                  onChange={(event) => setServicoForm((form) => ({ ...form, nome: event.target.value }))}
                  placeholder="Ex: Corte masculino"
                  value={servicoForm.nome}
                />
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
              <label>
                Duracao em minutos
                <input
                  inputMode="numeric"
                  onChange={(event) => setServicoForm((form) => ({ ...form, duracao: event.target.value }))}
                  type="number"
                  value={servicoForm.duracao}
                />
              </label>
              <button className="admin-pill-button primary wide" disabled={salvandoServico} type="submit">
                {salvandoServico ? "Salvando..." : "Adicionar servico"}
              </button>
            </form>
          </AddFormSheet>
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
              <EditableProdutoList produtos={produtos} setProdutos={setProdutos} onSave={atualizarProduto} />
            </article>
          </AdminSectionShell>
        )}

        {addProdutoOpen && (
          <AddFormSheet onClose={() => setAddProdutoOpen(false)} title="Novo produto">
            <form className="form-stack add-sheet-form" onSubmit={cadastrarProduto}>
              <label>
                Nome
                <input
                  onChange={(event) => setProdutoForm((form) => ({ ...form, nome: event.target.value }))}
                  placeholder="Ex: Pomada"
                  value={produtoForm.nome}
                />
              </label>
              <label>
                Preco de venda
                <input
                  inputMode="decimal"
                  onChange={(event) => setProdutoForm((form) => ({ ...form, preco: event.target.value }))}
                  placeholder="R$ 0,00"
                  type="number"
                  value={produtoForm.preco}
                />
              </label>
              <label>
                Preco de custo
                <input
                  inputMode="decimal"
                  onChange={(event) => setProdutoForm((form) => ({ ...form, custo: event.target.value }))}
                  placeholder="R$ 0,00"
                  type="number"
                  value={produtoForm.custo}
                />
              </label>
              {produtoForm.preco && produtoForm.custo && Number(produtoForm.custo) > 0 && (
                <p className="produto-lucro-preview">
                  Margem:{" "}
                  <strong>
                    {(((Number(produtoForm.preco) - Number(produtoForm.custo)) / Number(produtoForm.custo)) * 100).toFixed(1)}%
                  </strong>{" "}
                  de lucro
                </p>
              )}
              <label>
                Comissao (%)
                <input
                  inputMode="decimal"
                  onChange={(event) => setProdutoForm((form) => ({ ...form, comissao: event.target.value }))}
                  placeholder="Ex: 20%"
                  type="number"
                  value={produtoForm.comissao}
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
              <label className="foto-upload-label">
                Foto do produto
                <input
                  accept="image/*"
                  className="foto-upload-input"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      const dataUrl = await redimensionarFoto(file);
                      setProdutoForm((form) => ({ ...form, foto_url: dataUrl }));
                    }
                  }}
                  type="file"
                />
                {produtoForm.foto_url && (
                  <img alt="Preview" className="foto-preview-thumb" src={produtoForm.foto_url} />
                )}
              </label>
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
                className={periodoFinanceiro === "hoje" ? "active" : ""}
                onClick={() => setPeriodoFinanceiro("hoje")}
                type="button"
              >
                Hoje
              </button>
              <button
                className={periodoFinanceiro === "7" ? "active" : ""}
                onClick={() => setPeriodoFinanceiro("7")}
                type="button"
              >
                7 dias
              </button>
              <button
                className={periodoFinanceiro === "30" ? "active" : ""}
                onClick={() => setPeriodoFinanceiro("30")}
                type="button"
              >
                30 dias
              </button>
              <button
                className={periodoFinanceiro === "todos" ? "active" : ""}
                onClick={() => setPeriodoFinanceiro("todos")}
                type="button"
              >
                Tudo
              </button>
            </div>

            <section className="finance-dashboard-grid" aria-label="Resumo financeiro">
              <MetricCard helper="receita no periodo" label="Faturamento" value={formatarMoeda(resumoFinanceiro.totalReceita)} />
              <MetricCard helper="vendas registradas" label="Vendas" value={vendasFiltradas.length} />
              <MetricCard helper="itens com baixo estoque" label="Estoque baixo" value={resumoFinanceiro.estoqueBaixo.length} />
              <PaymentChart items={resumoFinanceiro.formasPagamento} total={resumoFinanceiro.totalReceita} />
            </section>

            <section className="finance-card-grid">
              <FinanceRankingCard items={resumoFinanceiro.produtosMaisVendidos} title="Produtos com mais saida" />
              <FinanceRankingCard items={resumoFinanceiro.servicosMaisVendidos} title="Servicos mais vendidos" />
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
                <EditableClienteList clientes={clientes} setClientes={setClientes} onSave={atualizarCliente} />
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

      {atendimentoAberto && (
        <SaleModal
          agendamento={atendimentoAberto}
          finalizando={finalizandoVenda}
          itensVenda={itensVenda}
          onClose={() => setAtendimentoAberto(null)}
          onConfirm={finalizarAtendimento}
          produtos={produtos}
          setItensVenda={setItensVenda}
          total={totalAtendimentoAberto}
        />
      )}
    </main>
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
        <h2>INBARBER</h2>
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

function AgendaHero({
  agendamentos,
  dias,
  empresa,
  nomeDono,
  onOpenMenu,
  vendas,
}: {
  agendamentos: Agendamento[];
  dias: DiaPainel[];
  empresa?: Empresa | null;
  nomeDono: string;
  onOpenMenu: () => void;
  vendas: Venda[];
}) {
  const hojeIso = dataLocalISO();
  const agendamentosHoje = agendamentos.filter((item) => item.data_agendamento.slice(0, 10) === hojeIso);
  const vendasHoje = vendas.filter((venda) => venda.created_at.slice(0, 10) === hojeIso);
  const totalHoje = vendasHoje.reduce((total, venda) => total + (venda.total || 0), 0);
  const totalSemana = vendas.reduce((total, venda) => total + (venda.total || 0), 0);

  return (
    <section className="agenda-hero">
      <div className="agenda-title-row">
        <div>
          {empresa?.features?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Logo" className="empresa-logo-hero" src={empresa.features.logo_url} />
          )}
          <h2>Olá, {nomeDono || empresa?.nome || "barbeiro"}</h2>
          <p>Você está em sua agenda.</p>
        </div>
        <button aria-label="Abrir menu" onClick={onOpenMenu} type="button">
          ☰
        </button>
      </div>

      <strong className="agenda-week-label">
        {dias[0]?.labelCompleto} à {dias[dias.length - 1]?.labelCompleto}
      </strong>

      <div className="agenda-day-strip">
        {dias.map((dia, index) => (
          <span className={index === 0 ? "active" : ""} key={dia.iso}>
            <small>{dia.semana}</small>
            <strong>{dia.dia}</strong>
          </span>
        ))}
      </div>

      <div className="agenda-summary-grid">
        <article className="hot">
          <span>Hoje</span>
          <strong>{formatarMoeda(totalHoje)}</strong>
          <em>{agendamentosHoje.length}</em>
        </article>
        <article>
          <span>Esta semana</span>
          <strong>{formatarMoeda(totalSemana)}</strong>
          <em>{agendamentos.length}</em>
        </article>
      </div>
    </section>
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

function MetricCard({ helper, label, value }: { helper: string; label: string; value: number | string }) {
  return (
    <article className="metric-card admin-metric-card">
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

        return (
          <article className={`admin-appointment-card ${variant === "history" ? "is-history" : ""}`} key={agendamento.id}>
            <div>
              <strong>{cliente?.nome || "Cliente"}</strong>
              <span>{cliente?.telefone || "Telefone nao informado"}</span>
            </div>
            <dl>
              <div>
                <dt>Servico</dt>
                <dd>{servico?.nome || "Servico"}</dd>
              </div>
              <div>
                <dt>Horario</dt>
                <dd>{new Date(agendamento.data_agendamento).toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{agendamento.status}</dd>
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
              <span>{item.nome}</span>
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
  finalizando,
  itensVenda,
  onClose,
  onConfirm,
  produtos,
  setItensVenda,
  total,
}: {
  agendamento: Agendamento;
  finalizando: boolean;
  itensVenda: Record<number, string>;
  onClose: () => void;
  onConfirm: () => void;
  produtos: Produto[];
  setItensVenda: Dispatch<SetStateAction<Record<number, string>>>;
  total: number;
}) {
  const cliente = firstRelation(agendamento.clientes);
  const servico = firstRelation(agendamento.servicos);

  return (
    <section className="sale-modal-backdrop" role="dialog" aria-modal="true" aria-label="Finalizar atendimento">
      <article className="sale-modal">
        <div className="sale-modal-header">
          <div>
            <p className="admin-kicker">Fechar comanda</p>
            <h2>{cliente?.nome || "Cliente"}</h2>
            <p>
              {servico?.nome || "Servico"} - {formatarMoeda(servico?.preco || 0)}
            </p>
          </div>
          <button onClick={onClose} type="button">
            Fechar
          </button>
        </div>

        <div className="sale-products">
          {produtos.length === 0 ? (
            <div className="empty-state">Nenhum produto cadastrado para adicionar na venda.</div>
          ) : (
            produtos.map((produto) => (
              <label className="sale-product-row" key={produto.id}>
                <ProductPhoto produto={produto} />
                <span>
                  <strong>{produto.nome}</strong>
                  <small>
                    {formatarMoeda(produto.preco || 0)} · estoque {produto.estoque || 0}
                  </small>
                </span>
                <input
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
            ))
          )}
        </div>

        <div className="sale-total">
          <span>Total do atendimento</span>
          <strong>{formatarMoeda(total)}</strong>
        </div>

        <button className="admin-pill-button primary wide" disabled={finalizando} onClick={onConfirm} type="button">
          {finalizando ? "Finalizando..." : "Finalizar e lancar financeiro"}
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

function formatarMoeda(valor: number) {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(valor);
}

function filtrarVendasPorPeriodo(vendas: Venda[], periodo: PeriodoFinanceiro) {
  if (periodo === "todos") return vendas;

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setHours(0, 0, 0, 0);

  if (periodo === "7") inicio.setDate(inicio.getDate() - 6);
  if (periodo === "30") inicio.setDate(inicio.getDate() - 29);

  return vendas.filter((venda) => new Date(venda.created_at) >= inicio);
}

function calcularResumoFinanceiro(vendas: Venda[], agendamentos: Agendamento[], produtos: Produto[]) {
  const produtoTotais = new Map<string, number>();
  const servicoTotais = new Map<string, number>();
  const formaTotais = new Map<string, { total: number; valor: number }>();
  const produtosComGiro = new Set<number>();

  vendas.forEach((venda) => {
    const forma = venda.forma_pagamento || "Nao informado";
    const formaAtual = formaTotais.get(forma) || { total: 0, valor: 0 };
    formaTotais.set(forma, {
      total: formaAtual.total + 1,
      valor: formaAtual.valor + (venda.total || 0),
    });

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
    agendamentos
      .filter((agendamento) => agendamento.status === "finalizado")
      .forEach((agendamento) => {
        const servico = firstRelation(agendamento.servicos);
        if (!servico?.nome) return;
        servicoTotais.set(servico.nome, (servicoTotais.get(servico.nome) || 0) + 1);
      });
  }

  return {
    estoqueBaixo: produtos.filter((produto) => (produto.estoque || 0) <= 2),
    formasPagamento: Array.from(formaTotais.entries())
      .map(([nome, dados]) => ({ nome, total: dados.total, valor: dados.valor }))
      .sort((a, b) => b.valor - a.valor),
    produtosMaisVendidos: ordenarRanking(produtoTotais),
    produtosSemGiro: produtos.filter((produto) => !produtosComGiro.has(produto.id)),
    servicosMaisVendidos: ordenarRanking(servicoTotais),
    totalReceita: vendas.reduce((total, venda) => total + (venda.total || 0), 0),
  };
}

function ordenarRanking(totais: Map<string, number>) {
  return Array.from(totais.entries())
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

function EditableServicoList({
  onSave,
  servicos,
  setServicos,
}: {
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
              <div className="compact-row-main">
                <strong>{servico.nome}</strong>
                <span>
                  {servico.duracao || 30} min. - {formatarMoeda(servico.preco || 0)}
                </span>
              </div>
              <button className="row-icon-button" onClick={() => setEditandoId(editando ? null : servico.id)} type="button">
                Editar
              </button>

              {editando && (
                <div className="compact-edit-panel">
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
                  <label>
                    Duracao
                    <input
                      onChange={(event) =>
                        setServicos(
                          servicos.map((item) =>
                            item.id === servico.id ? { ...item, duracao: Number(event.target.value) } : item,
                          ),
                        )
                      }
                      type="number"
                      value={servico.duracao || 30}
                    />
                  </label>
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
  onSave,
  produtos,
  setProdutos,
}: {
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
              <button className="row-icon-button" onClick={() => setEditandoId(editando ? null : produto.id)} type="button">
                Editar
              </button>

              {editando && (
                <div className="compact-edit-panel">
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
                  <label>
                    Preco de venda
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
                    Preco de custo
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
                  {produto.preco && produto.preco_custo && produto.preco_custo > 0 && (
                    <p className="produto-lucro-preview">
                      Margem: <strong>{(((produto.preco - produto.preco_custo) / produto.preco_custo) * 100).toFixed(1)}%</strong> de lucro
                    </p>
                  )}
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
                  <label className="foto-upload-label">
                    Foto do produto
                    <input
                      accept="image/*"
                      className="foto-upload-input"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          const dataUrl = await redimensionarFoto(file);
                          setProdutos(produtos.map((item) => (item.id === produto.id ? { ...item, foto_url: dataUrl } : item)));
                        }
                      }}
                      type="file"
                    />
                    {produto.foto_url && (
                      <img alt="Preview" className="foto-preview-thumb" src={produto.foto_url} />
                    )}
                  </label>
                  <button className="admin-pill-button primary" onClick={async () => { await onSave(produto); setEditandoId(null); }} type="button">
                    Salvar produto
                  </button>
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
  onSave,
  setClientes,
}: {
  clientes: ClienteResumo[];
  onSave: (cliente: ClienteResumo) => Promise<void>;
  setClientes: Dispatch<SetStateAction<ClienteResumo[]>>;
}) {
  const [busca, setBusca] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [limite, setLimite] = useState(8);
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
          setLimite(8);
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
              <div className="client-avatar" aria-hidden="true">
                {cliente.nome.slice(0, 2)}
              </div>
              <div className="client-card-main">
                <strong>{cliente.nome}</strong>
                <span>{cliente.telefone || "WhatsApp nao informado"}</span>
                <small>Aniversario: {formatarAniversario(cliente.data_nascimento)}</small>
              </div>
              <button className="row-icon-button" onClick={() => setEditandoId(editando ? null : cliente.id)} type="button">
                Editar
              </button>

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
                  <button className="admin-pill-button primary" onClick={() => onSave(cliente)} type="button">
                    Salvar cliente
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {clientesFiltrados.length === 0 && <div className="empty-state">Nenhum cliente encontrado.</div>}
      {clientesFiltrados.length > limite && (
        <button className="manager-more-button" onClick={() => setLimite((valor) => valor + 8)} type="button">
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

        <article className="inteligencia-card">
          <h3>Servicos mais populares — {labelPeriodo}</h3>
          {topServicos.length === 0 ? (
            <span className="inteligencia-vazio">Sem dados suficientes</span>
          ) : (
            <ul>
              {topServicos.map(([nome, qtd]) => (
                <li key={nome}><strong>{nome}</strong> — {qtd}x</li>
              ))}
            </ul>
          )}
        </article>

        <article className="inteligencia-card destaque-alerta">
          <h3>Produtos com baixo giro</h3>
          <p className="inteligencia-subtitulo">Menos de 2 unidades vendidas em 30 dias — considere fazer uma promocao.</p>
          {produtosBaixoGiro.length === 0 ? (
            <span className="inteligencia-vazio">Todos os produtos estao girando bem!</span>
          ) : (
            <ul>
              {produtosBaixoGiro.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <strong>{p.nome}</strong>
                  <span>{giroMap.get(p.id) || 0} vend. — estoque: {p.estoque || 0}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="inteligencia-card destaque-positivo">
          <h3>Sugestao de recompra</h3>
          <p className="inteligencia-subtitulo">Produtos que mais saem — mantenha estoque em dia.</p>
          {produtosMaisVendidos.length === 0 ? (
            <span className="inteligencia-vazio">Sem dados de venda ainda.</span>
          ) : (
            <ul>
              {produtosMaisVendidos.map((p) => (
                <li key={p.id}>
                  <strong>{p.nome}</strong>
                  <span>{giroMap.get(p.id)} vendidos — estoque: {p.estoque || 0}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="inteligencia-card destaque-alerta">
          <h3>Clientes para reativar</h3>
          <p className="inteligencia-subtitulo">{clientesInativos.length} clientes sem visita ha mais de 30 dias.</p>
          {clientesInativos.length === 0 ? (
            <span className="inteligencia-vazio">Nenhum cliente inativo!</span>
          ) : (
            <ul>
              {clientesInativos.slice(0, 5).map((c) => (
                <li key={c.id}>
                  {c.telefone && (
                    <a
                      href={"https://wa.me/55" + c.telefone.replace(/\D/g, "") + "?text=" + encodeURIComponent("Oi " + c.nome + "! Que tal dar uma passada na barbearia?")}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Whats
                    </a>
                  )}
                </li>
              ))}
              {clientesInativos.length > 5 && <li>...e mais {clientesInativos.length - 5} clientes</li>}
            </ul>
          )}
        </article>

        {produtosBaixoGiro.length > 0 && (
          <article className="inteligencia-card destaque-sugestao">
            <h3>Sugestao de promocao</h3>
            <ul>
              {produtosBaixoGiro.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <strong>Promocao de {p.nome}</strong>
                  <span>
                    {p.preco_custo && p.preco
                      ? "Custo " + formatarMoeda(p.preco_custo) + " — venda " + formatarMoeda(p.preco) + ". Pode dar desconto de ate " + Math.floor(((p.preco - p.preco_custo) / p.preco) * 100) + "%."
                      : "Preco atual: " + formatarMoeda(p.preco || 0) + ". Considere um desconto para girar o estoque."}
                  </span>
                </li>
              ))}
            </ul>
          </article>
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
