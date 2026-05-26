"use client";

import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const EMPRESA_ID = 1;

type Empresa = {
  id: number;
  nome: string;
  plano: string | null;
  ativo: boolean | null;
};

type Servico = {
  id: number;
  nome: string;
  preco: number;
  duracao: number | null;
};

type Produto = {
  foto_url?: string | null;
  id: number;
  nome: string;
  preco: number | null;
  estoque: number | null;
};

type ClienteResumo = {
  data_nascimento?: string | null;
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

type AdminSection = "visao" | "agenda" | "servicos" | "produtos" | "financeiro" | "clientes";
type PeriodoFinanceiro = "hoje" | "7" | "30" | "todos";

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] || null : value;
}

function formatarErroSupabase(errorMessage: string) {
  if (errorMessage.includes("row-level security policy")) {
    return "Sem permissao no Supabase. Rode o SQL de policies para liberar esta acao.";
  }

  return errorMessage;
}

export default function AdminDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSenha, setLoginSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loginCarregando, setLoginCarregando] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>("visao");
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
  const [produtoForm, setProdutoForm] = useState({ estoque: "0", foto_url: "", nome: "", preco: "" });
  const [periodoFinanceiro, setPeriodoFinanceiro] = useState<PeriodoFinanceiro>("hoje");
  const [atendimentoAberto, setAtendimentoAberto] = useState<Agendamento | null>(null);
  const [itensVenda, setItensVenda] = useState<Record<number, string>>({});
  const [salvandoServico, setSalvandoServico] = useState(false);
  const [salvandoProduto, setSalvandoProduto] = useState(false);
  const [finalizandoVenda, setFinalizandoVenda] = useState(false);

  const linkPublico = typeof window === "undefined" ? "/agendamentos" : `${window.location.origin}/agendamentos`;

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

  const proximosAgendamentos = useMemo(() => {
    return [...agendamentos]
      .sort((a, b) => new Date(a.data_agendamento).getTime() - new Date(b.data_agendamento).getTime())
      .slice(0, 6);
  }, [agendamentos]);

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

    const [empresaResponse, servicosResponse, agendamentosResponse, produtosResponse, clientesResponse, vendasResponse] =
      await Promise.all([
      supabase.from("empresas").select("id,nome,plano,ativo").eq("id", EMPRESA_ID).maybeSingle(),
      supabase.from("servicos").select("id,nome,preco,duracao").eq("empresa_id", EMPRESA_ID).order("nome"),
      supabase
        .from("agendamentos")
        .select("id,cliente_id,servico_id,data_agendamento,status,clientes(nome,telefone),servicos(nome,preco)")
        .eq("empresa_id", EMPRESA_ID)
        .neq("status", "cancelado")
        .order("data_agendamento", { ascending: true }),
      supabase.from("produtos").select("id,nome,preco,estoque,foto_url").eq("empresa_id", EMPRESA_ID).order("nome"),
      supabase
        .from("clientes")
        .select("nome,telefone,data_nascimento")
        .eq("empresa_id", EMPRESA_ID)
        .not("data_nascimento", "is", null)
        .order("data_nascimento", { ascending: true }),
      supabase
        .from("vendas")
        .select("id,created_at,total,agendamento_id,agendamentos(data_agendamento,servicos(nome,preco)),venda_itens(produto_id,quantidade,valor_unitario,produtos(nome))")
        .eq("empresa_id", EMPRESA_ID)
        .order("created_at", { ascending: false }),
    ]);

    if (empresaResponse.data) setEmpresa(empresaResponse.data as Empresa);
    if (servicosResponse.data) setServicos(servicosResponse.data as Servico[]);
    if (agendamentosResponse.data) setAgendamentos(agendamentosResponse.data as unknown as Agendamento[]);
    if (clientesResponse.data) setClientes(clientesResponse.data as ClienteResumo[]);

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

    if (empresaResponse.error || servicosResponse.error || agendamentosResponse.error || clientesResponse.error) {
      setMensagem("Alguns dados nao puderam ser carregados. Confira as politicas RLS no Supabase.");
    }
  }

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
      empresa_id: EMPRESA_ID,
      nome: servicoForm.nome.trim(),
      preco: Number(servicoForm.preco),
    });
    setSalvandoServico(false);

    if (error) {
      setMensagem(`Erro ao cadastrar servico: ${formatarErroSupabase(error.message)}`);
      return;
    }

    setServicoForm({ duracao: "30", nome: "", preco: "" });
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
      empresa_id: EMPRESA_ID,
      estoque: Number(produtoForm.estoque || 0),
      foto_url: produtoForm.foto_url.trim() || null,
      nome: produtoForm.nome.trim(),
      preco: produtoForm.preco ? Number(produtoForm.preco) : null,
    });
    setSalvandoProduto(false);

    if (error) {
      setMensagem(`Erro ao cadastrar produto: ${formatarErroSupabase(error.message)}`);
      return;
    }

    setProdutoForm({ estoque: "0", foto_url: "", nome: "", preco: "" });
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
      .eq("empresa_id", EMPRESA_ID);

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
        estoque: produto.estoque || 0,
        foto_url: produto.foto_url || null,
        nome: produto.nome,
        preco: produto.preco,
      })
      .eq("id", produto.id)
      .eq("empresa_id", EMPRESA_ID);

    if (error) {
      setMensagem(`Erro ao atualizar produto: ${formatarErroSupabase(error.message)}`);
      return;
    }

    await carregarDados();
    setMensagem("Produto atualizado com sucesso.");
  }

  async function copiarLink() {
    await navigator.clipboard.writeText(linkPublico);
    setMensagem("Link publico copiado para enviar aos clientes.");
  }

  function abrirFinalizacao(agendamento: Agendamento) {
    setAtendimentoAberto(agendamento);
    setItensVenda({});
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
        empresa_id: EMPRESA_ID,
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
            .eq("empresa_id", EMPRESA_ID),
        ),
      );
    }

    await supabase
      .from("agendamentos")
      .update({ status: "finalizado" })
      .eq("id", atendimentoAberto.id)
      .eq("empresa_id", EMPRESA_ID);

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
          <span>BMS</span>
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
            onClick={() => setActiveSection("visao")}
          />
          <AdminMenuButton active={activeSection === "agenda"} icon="◷" label="Agenda" onClick={() => setActiveSection("agenda")} />
          <AdminMenuButton
            active={activeSection === "servicos"}
            icon="✂"
            label="Servicos"
            onClick={() => setActiveSection("servicos")}
          />
          <AdminMenuButton
            active={activeSection === "produtos"}
            icon="▣"
            label="Produtos"
            onClick={() => setActiveSection("produtos")}
          />
          <AdminMenuButton
            active={activeSection === "financeiro"}
            icon="$"
            label="Financeiro"
            onClick={() => setActiveSection("financeiro")}
          />
          <AdminMenuButton active={activeSection === "clientes"} icon="♡" label="Clientes" onClick={() => setActiveSection("clientes")} />
        </nav>

        <div className="admin-sidebar-footer">
          <Link href="/agendamentos">Link do cliente</Link>
          <button onClick={sairDoPainel} type="button">
            Sair
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <div>
            <p className="admin-kicker">Painel da barbearia</p>
            <h1>{empresa?.nome || "BMS Sistema"}</h1>
            <p>Agenda, servicos, produtos e relacionamento com clientes em areas separadas.</p>
          </div>

          <div className="admin-header-actions">
            <button className="admin-pill-button secondary" onClick={copiarLink} type="button">
              Copiar link do cliente
            </button>
            <Link className="admin-pill-button primary" href="/agendamentos">
              Ver agendamento
            </Link>
          </div>
        </header>

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
              <MetricCard helper="agendamentos ativos" label="Agendamentos" value={agendamentos.length} />
            </section>

            <section className="admin-two-columns">
              <article className="admin-panel">
                <h2>Ranking de agendamentos</h2>
                <RankingList items={ranking} />
              </article>

              <article className="admin-panel">
                <h2>Proximos lembretes</h2>
                <AppointmentList agendamentos={proximosAgendamentos} onFinish={abrirFinalizacao} />
              </article>
            </section>
          </AdminSectionShell>
        )}

        {activeSection === "agenda" && (
          <AdminSectionShell
            description="Veja os proximos clientes agendados e use esta area para acompanhar lembretes."
            title="Agenda"
          >
            <article className="admin-panel">
              <h2>Agendamentos ativos</h2>
              <AppointmentList agendamentos={agendamentos} onFinish={abrirFinalizacao} />
            </article>
          </AdminSectionShell>
        )}

        {activeSection === "servicos" && (
          <AdminSectionShell
            description="Cadastre os servicos que aparecem no link publico e edite valores ou duracao."
            title="Servicos"
          >
            <section className="admin-two-columns">
              <article className="admin-panel">
                <h2>Cadastrar servico</h2>
                <form className="form-stack admin-form" onSubmit={cadastrarServico}>
                  <label>
                    Nome
                    <input
                      onChange={(event) => setServicoForm((form) => ({ ...form, nome: event.target.value }))}
                      placeholder="Corte masculino"
                      value={servicoForm.nome}
                    />
                  </label>
                  <label>
                    Preco
                    <input
                      inputMode="decimal"
                      onChange={(event) => setServicoForm((form) => ({ ...form, preco: event.target.value }))}
                      placeholder="50"
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
                    {salvandoServico ? "Salvando..." : "Cadastrar servico"}
                  </button>
                </form>
              </article>

              <article className="admin-panel">
                <h2>Editar servicos</h2>
                <EditableServicoList servicos={servicos} setServicos={setServicos} onSave={atualizarServico} />
              </article>
            </section>
          </AdminSectionShell>
        )}

        {activeSection === "produtos" && (
          <AdminSectionShell
            description="Controle produtos vendidos na barbearia e mantenha estoque e preco organizados."
            title="Produtos"
          >
            <section className="admin-two-columns">
              <article className="admin-panel">
                <h2>Cadastrar produto</h2>
                {produtoAviso && <p className="notice notice-error">{produtoAviso}</p>}
                <form className="form-stack admin-form" onSubmit={cadastrarProduto}>
                  <label>
                    Nome
                    <input
                      onChange={(event) => setProdutoForm((form) => ({ ...form, nome: event.target.value }))}
                      placeholder="Pomada modeladora"
                      value={produtoForm.nome}
                    />
                  </label>
                  <label>
                    Preco
                    <input
                      inputMode="decimal"
                      onChange={(event) => setProdutoForm((form) => ({ ...form, preco: event.target.value }))}
                      placeholder="35"
                      type="number"
                      value={produtoForm.preco}
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
                    Foto do produto opcional
                    <input
                      onChange={(event) => setProdutoForm((form) => ({ ...form, foto_url: event.target.value }))}
                      placeholder="Cole uma URL de imagem"
                      type="url"
                      value={produtoForm.foto_url}
                    />
                  </label>
                  <button
                    className="admin-pill-button primary wide"
                    disabled={salvandoProduto || Boolean(produtoAviso)}
                    type="submit"
                  >
                    {salvandoProduto ? "Salvando..." : "Cadastrar produto"}
                  </button>
                </form>
              </article>

              <article className="admin-panel">
                <h2>Editar produtos</h2>
                <EditableProdutoList produtos={produtos} setProdutos={setProdutos} onSave={atualizarProduto} />
              </article>
            </section>
          </AdminSectionShell>
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

            <section className="admin-metrics-grid" aria-label="Resumo financeiro">
              <MetricCard helper="receita no periodo" label="Faturamento" value={formatarMoeda(resumoFinanceiro.totalReceita)} />
              <MetricCard helper="vendas registradas" label="Vendas" value={vendasFiltradas.length} />
              <MetricCard helper="itens com baixo estoque" label="Estoque baixo" value={resumoFinanceiro.estoqueBaixo.length} />
            </section>

            <section className="admin-two-columns">
              <article className="admin-panel">
                <h2>Produtos com mais saida</h2>
                <RankingList items={resumoFinanceiro.produtosMaisVendidos} />
              </article>

              <article className="admin-panel">
                <h2>Servicos mais vendidos</h2>
                <RankingList items={resumoFinanceiro.servicosMaisVendidos} />
              </article>
            </section>

            <section className="admin-two-columns">
              <article className="admin-panel">
                <h2>Produtos sem giro</h2>
                <ProductStockList produtos={resumoFinanceiro.produtosSemGiro} emptyLabel="Todos os produtos tiveram giro." />
              </article>

              <article className="admin-panel">
                <h2>Controle de estoque</h2>
                <ProductStockList produtos={produtos} emptyLabel="Nenhum produto cadastrado." />
              </article>
            </section>
          </AdminSectionShell>
        )}

        {activeSection === "clientes" && (
          <AdminSectionShell
            description="Veja aniversarios cadastrados no fluxo publico para relacionamento com clientes."
            title="Clientes"
          >
            <article className="admin-panel">
              <h2>Aniversarios</h2>
              {clientes.length === 0 ? (
                <div className="empty-state">Nenhum cliente com data de nascimento cadastrada ainda.</div>
              ) : (
                <div className="simple-list">
                  {clientes.map((cliente) => (
                    <div key={`${cliente.nome}-${cliente.telefone}-${cliente.data_nascimento}`}>
                      <strong>{cliente.nome}</strong>
                      <span>{formatarAniversario(cliente.data_nascimento)}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </AdminSectionShell>
        )}
      </section>

      <nav className="admin-mobile-nav" aria-label="Menu principal mobile">
        <AdminMenuButton active={activeSection === "visao"} icon="⌂" label="Inicio" onClick={() => setActiveSection("visao")} />
        <AdminMenuButton active={activeSection === "agenda"} icon="◷" label="Agenda" onClick={() => setActiveSection("agenda")} />
        <AdminMenuButton
          active={activeSection === "servicos"}
          icon="✂"
          label="Servicos"
          onClick={() => setActiveSection("servicos")}
        />
        <AdminMenuButton
          active={activeSection === "produtos"}
          icon="▣"
          label="Produtos"
          onClick={() => setActiveSection("produtos")}
        />
        <AdminMenuButton active={activeSection === "financeiro"} icon="$" label="Caixa" onClick={() => setActiveSection("financeiro")} />
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
  onFinish,
}: {
  agendamentos: Agendamento[];
  onFinish?: (agendamento: Agendamento) => void;
}) {
  if (agendamentos.length === 0) {
    return <div className="empty-state">Nenhum agendamento ativo por enquanto.</div>;
  }

  return (
    <div className="appointment-card-list">
      {agendamentos.map((agendamento) => {
        const cliente = firstRelation(agendamento.clientes);
        const servico = firstRelation(agendamento.servicos);

        return (
          <article className="admin-appointment-card" key={agendamento.id}>
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
            {onFinish && agendamento.status !== "finalizado" && (
              <button className="admin-pill-button primary wide" onClick={() => onFinish(agendamento)} type="button">
                Finalizar atendimento
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ProductStockList({ emptyLabel, produtos }: { emptyLabel: string; produtos: Produto[] }) {
  if (produtos.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="product-stock-list">
      {produtos.map((produto) => (
        <article className="product-stock-card" key={produto.id}>
          <ProductPhoto produto={produto} />
          <div>
            <strong>{produto.nome}</strong>
            <small>{formatarMoeda(produto.preco || 0)}</small>
          </div>
          <em>{produto.estoque || 0} un.</em>
        </article>
      ))}
    </div>
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
  if (servicos.length === 0) {
    return <div className="empty-state">Nenhum servico cadastrado ainda.</div>;
  }

  return (
    <div className="editable-list">
      {servicos.map((servico) => (
        <article className="editable-row" key={servico.id}>
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
          <button className="admin-pill-button primary" onClick={() => onSave(servico)} type="button">
            Salvar
          </button>
        </article>
      ))}
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
  if (produtos.length === 0) {
    return <div className="empty-state">Nenhum produto cadastrado ainda.</div>;
  }

  return (
    <div className="editable-list">
      {produtos.map((produto) => (
        <article className="editable-row" key={produto.id}>
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
            Preco
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
            Foto
            <input
              onChange={(event) =>
                setProdutos(
                  produtos.map((item) => (item.id === produto.id ? { ...item, foto_url: event.target.value } : item)),
                )
              }
              placeholder="URL da imagem"
              value={produto.foto_url || ""}
            />
          </label>
          <button className="admin-pill-button primary" onClick={() => onSave(produto)} type="button">
            Salvar
          </button>
        </article>
      ))}
    </div>
  );
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
