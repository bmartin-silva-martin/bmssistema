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
  id: number;
  data_agendamento: string;
  status: string;
  clientes: ClienteResumo | ClienteResumo[] | null;
  servicos: ServicoResumo | ServicoResumo[] | null;
};

type RankingItem = {
  nome: string;
  total: number;
};

type AdminSection = "visao" | "agenda" | "servicos" | "produtos" | "clientes";

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
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [produtoAviso, setProdutoAviso] = useState("");
  const [servicoForm, setServicoForm] = useState({ duracao: "30", nome: "", preco: "" });
  const [produtoForm, setProdutoForm] = useState({ estoque: "0", nome: "", preco: "" });
  const [salvandoServico, setSalvandoServico] = useState(false);
  const [salvandoProduto, setSalvandoProduto] = useState(false);

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

  async function carregarDados() {
    if (!isSupabaseConfigured) {
      setMensagem("Supabase nao configurado. Confira o .env.local.");
      return;
    }

    const [empresaResponse, servicosResponse, agendamentosResponse, produtosResponse, clientesResponse] = await Promise.all([
      supabase.from("empresas").select("id,nome,plano,ativo").eq("id", EMPRESA_ID).maybeSingle(),
      supabase.from("servicos").select("id,nome,preco,duracao").eq("empresa_id", EMPRESA_ID).order("nome"),
      supabase
        .from("agendamentos")
        .select("id,data_agendamento,status,clientes(nome,telefone),servicos(nome,preco)")
        .eq("empresa_id", EMPRESA_ID)
        .neq("status", "cancelado")
        .order("data_agendamento", { ascending: true }),
      supabase.from("produtos").select("id,nome,preco,estoque").eq("empresa_id", EMPRESA_ID).order("nome"),
      supabase
        .from("clientes")
        .select("nome,telefone,data_nascimento")
        .eq("empresa_id", EMPRESA_ID)
        .not("data_nascimento", "is", null)
        .order("data_nascimento", { ascending: true }),
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
      nome: produtoForm.nome.trim(),
      preco: produtoForm.preco ? Number(produtoForm.preco) : null,
    });
    setSalvandoProduto(false);

    if (error) {
      setMensagem(`Erro ao cadastrar produto: ${formatarErroSupabase(error.message)}`);
      return;
    }

    setProdutoForm({ estoque: "0", nome: "", preco: "" });
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
          <AdminMenuButton active={activeSection === "visao"} label="Visao geral" onClick={() => setActiveSection("visao")} />
          <AdminMenuButton active={activeSection === "agenda"} label="Agenda" onClick={() => setActiveSection("agenda")} />
          <AdminMenuButton active={activeSection === "servicos"} label="Servicos" onClick={() => setActiveSection("servicos")} />
          <AdminMenuButton active={activeSection === "produtos"} label="Produtos" onClick={() => setActiveSection("produtos")} />
          <AdminMenuButton active={activeSection === "clientes"} label="Clientes" onClick={() => setActiveSection("clientes")} />
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
                <AppointmentList agendamentos={proximosAgendamentos} />
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
              <AppointmentList agendamentos={proximosAgendamentos} />
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
    </main>
  );
}

function AdminMenuButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick} type="button">
      {label}
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

function MetricCard({ helper, label, value }: { helper: string; label: string; value: number }) {
  return (
    <article className="metric-card admin-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function AppointmentList({ agendamentos }: { agendamentos: Agendamento[] }) {
  if (agendamentos.length === 0) {
    return <div className="empty-state">Nenhum agendamento ativo por enquanto.</div>;
  }

  return (
    <div className="simple-list">
      {agendamentos.map((agendamento) => {
        const cliente = firstRelation(agendamento.clientes);
        const servico = firstRelation(agendamento.servicos);

        return (
          <div key={agendamento.id}>
            <strong>{cliente?.nome || "Cliente"}</strong>
            <span>
              {servico?.nome || "Servico"} em {new Date(agendamento.data_agendamento).toLocaleString("pt-BR")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatarAniversario(data?: string | null) {
  if (!data) return "Sem data";

  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
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
