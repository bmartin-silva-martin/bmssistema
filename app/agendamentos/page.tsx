"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const EMPRESA_ID_LEGADO = 1;
const BARBEARIA_NOME_PADRAO = "Barbearia Teste";
const HORARIOS_PADRAO = [
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
const DIAS_ATENDIMENTO_PADRAO = [1, 2, 3, 4, 5, 6];
const moeda = new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" });
const diasSemana = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
const meses = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

type Servico = {
  id: number;
  nome: string;
  preco: number;
  duracao: number | null;
};

type HorarioOcupado = {
  data_agendamento: string;
};

type EmpresaAgendaConfig = {
  id?: number | null;
  nome?: string | null;
  slug?: string | null;
  dias_atendimento?: number[] | null;
  horarios_atendimento?: string[] | null;
  servicos?: Servico[] | null;
};

type AgendamentoHistorico = {
  id: number;
  data_agendamento: string;
  servico: string;
  status: string;
};

function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

function horarioJaPassou(dataISO: string, hora: string) {
  const agora = new Date();
  const horarioEscolhido = new Date(`${dataISO}T${hora}:00`);

  return horarioEscolhido.getTime() <= agora.getTime();
}

function normalizarTelefoneBrasil(value: string) {
  let digits = value.replace(/\D/g, "");

  while (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }

  return digits;
}

function telefoneBrasilValido(value: string) {
  return /^55\d{10,11}$/.test(normalizarTelefoneBrasil(value));
}

function normalizarHorario(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);

  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

function montarDiasAgenda(diasAtendimento = DIAS_ATENDIMENTO_PADRAO) {
  const hoje = new Date();
  const diasPermitidos = diasAtendimento.length > 0 ? diasAtendimento : DIAS_ATENDIMENTO_PADRAO;
  const dias = [];
  let index = 0;

  while (dias.length < 7 && index < 21) {
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + index);

    if (diasPermitidos.includes(data.getDay())) {
      dias.push({
        dia: String(data.getDate()).padStart(2, "0"),
        label: dataLocalISO(data) === dataLocalISO() ? "HOJE" : String(data.getDate()).padStart(2, "0"),
        mes: meses[data.getMonth()],
        semana: diasSemana[data.getDay()],
        valor: dataLocalISO(data),
      });
    }

    index += 1;
  }

  return dias;
}

export default function AgendamentoPublicoPage() {
  const [empresaId, setEmpresaId] = useState(EMPRESA_ID_LEGADO);
  const [barbeariaNome, setBarbeariaNome] = useState(BARBEARIA_NOME_PADRAO);
  const [diasAgenda, setDiasAgenda] = useState(() => montarDiasAgenda());
  const [horariosDisponiveis, setHorariosDisponiveis] = useState(HORARIOS_PADRAO);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [ocupados, setOcupados] = useState<string[]>([]);
  const [servicoId, setServicoId] = useState<number | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [data, setData] = useState(diasAgenda[0]?.valor || "");
  const [horario, setHorario] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [agendamentoConcluido, setAgendamentoConcluido] = useState(false);
  const [agendamentoIdConfirmado, setAgendamentoIdConfirmado] = useState<number | null>(null);
  const [agendamentoCancelado, setAgendamentoCancelado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [modoCancelamento, setModoCancelamento] = useState(false);
  const [telefoneCancelamento, setTelefoneCancelamento] = useState("");
  const [buscandoAgendamentos, setBuscandoAgendamentos] = useState(false);
  const [agendamentosCliente, setAgendamentosCliente] = useState<{ id: number; data_agendamento: string; servico: string; status: string }[]>([]);
  const [historicoCliente, setHistoricoCliente] = useState<AgendamentoHistorico[]>([]);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [buscandoHistorico, setBuscandoHistorico] = useState(false);
  const [nomeConfirmado, setNomeConfirmado] = useState(false);
  const [notificacaoRespondida, setNotificacaoRespondida] = useState(false);
  const [aceitaLembrete, setAceitaLembrete] = useState(false);
  const [servicoConfirmado, setServicoConfirmado] = useState(false);
  const [horarioConfirmado, setHorarioConfirmado] = useState(false);
  const [profissionalId, setProfissionalId] = useState<number | null>(null);
  const fimDoFluxoRef = useRef<HTMLDivElement | null>(null);

  const primeiroNome = nome.trim().split(" ")[0] || "tudo bem";
  const servicoSelecionado = servicos.find((servico) => servico.id === servicoId);
  const diaSelecionado = useMemo(() => diasAgenda.find((dia) => dia.valor === data), [data, diasAgenda]);
  const horariosValidos = useMemo(
    () => horariosDisponiveis.filter((hora) => !horarioJaPassou(data, hora)),
    [data, horariosDisponiveis],
  );

  function rolarParaProximaEtapa() {
    window.setTimeout(() => {
      fimDoFluxoRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 120);
  }

  function getEmpresaParam() {
    if (typeof window === "undefined") return "";

    return new URLSearchParams(window.location.search).get("empresa")?.trim() || "";
  }

  function aplicarConfigEmpresa(config: EmpresaAgendaConfig) {
    const diasConfigurados = config.dias_atendimento?.length ? config.dias_atendimento : DIAS_ATENDIMENTO_PADRAO;
    const horariosConfigurados = config.horarios_atendimento?.length
      ? config.horarios_atendimento.map(normalizarHorario).sort()
      : HORARIOS_PADRAO;
    const novosDias = montarDiasAgenda(diasConfigurados);

    if (config.id) setEmpresaId(config.id);
    if (config.nome) setBarbeariaNome(config.nome);

    setDiasAgenda(novosDias);
    setHorariosDisponiveis(horariosConfigurados);
    setData((dataAtual) => (novosDias.some((dia) => dia.valor === dataAtual) ? dataAtual : novosDias[0]?.valor || ""));
  }

  const carregarConfiguracaoAgenda = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    const empresaParam = getEmpresaParam();
    const queryEmpresa = empresaParam ? `&empresa=${encodeURIComponent(empresaParam)}` : "";
    const response = await fetch(`/api/public-config?at=${Date.now()}${queryEmpresa}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      const erro = await response.json().catch(() => null);
      setMensagem(erro?.error || "Nao consegui carregar os horarios da barbearia. Atualize a pagina e tente novamente.");
      return;
    }

    aplicarConfigEmpresa((await response.json()) as EmpresaAgendaConfig);
  }, []);

  const carregarServicos = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    const empresaParam = getEmpresaParam();
    const queryEmpresa = empresaParam ? `&empresa=${encodeURIComponent(empresaParam)}` : "";
    const empresaResponse = await fetch(`/api/public-config?at=${Date.now()}${queryEmpresa}`, { cache: "no-store" });

    if (empresaResponse.ok) {
      const config = (await empresaResponse.json()) as EmpresaAgendaConfig;
      aplicarConfigEmpresa(config);
      setServicos(config.servicos || []);
    } else {
      const erro = await empresaResponse.json().catch(() => null);
      setMensagem(erro?.error || "Nao consegui carregar os horarios da barbearia. Atualize a pagina e tente novamente.");
    }
  }, []);

  const carregarHorariosOcupados = useCallback(async () => {
    if (!isSupabaseConfigured || !data) return;

    const params = new URLSearchParams({ empresa: String(empresaId), data });
    if (profissionalId) params.set("profissionalId", String(profissionalId));
    if (servicoId) params.set("servicoId", String(servicoId));

    const response = await fetch(`/api/public-availability?${params.toString()}`, { cache: "no-store" });
    const resultado = await response.json().catch(() => null);

    if (!response.ok) {
      setMensagem(resultado?.error || "Erro ao carregar horarios.");
      return;
    }

    setOcupados(Array.isArray(resultado?.ocupados) ? resultado.ocupados : []);
  }, [data, empresaId, profissionalId, servicoId]);

  useEffect(() => {
    async function carregarTela() {
      setCarregando(true);
      await carregarServicos();
      setCarregando(false);
    }

    carregarTela();
  }, [carregarServicos]);

  useEffect(() => {
    async function carregar() {
      await carregarHorariosOcupados();
    }

    carregar();
  }, [carregarHorariosOcupados]);

  useEffect(() => {
    if (!servicoConfirmado) return;

    const timer = window.setTimeout(() => {
      carregarConfiguracaoAgenda();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [carregarConfiguracaoAgenda, servicoConfirmado]);

  useEffect(() => {
    function recarregarAoVoltar() {
      if (document.visibilityState === "visible") {
        carregarConfiguracaoAgenda();
      }
    }

    document.addEventListener("visibilitychange", recarregarAoVoltar);
    window.addEventListener("focus", carregarConfiguracaoAgenda);

    return () => {
      document.removeEventListener("visibilitychange", recarregarAoVoltar);
      window.removeEventListener("focus", carregarConfiguracaoAgenda);
    };
  }, [carregarConfiguracaoAgenda]);

  async function pedirNotificacao() {
    if (!("Notification" in window)) {
      setAceitaLembrete(false);
      setMensagem("Seu navegador nao permite notificacoes. Vamos seguir com o agendamento pelo WhatsApp.");
      setNotificacaoRespondida(true);
      rolarParaProximaEtapa();
      return;
    }

    const permission = await Notification.requestPermission();
    setAceitaLembrete(permission === "granted");

    if (permission !== "granted") {
      setMensagem("Tudo bem, voce ainda pode agendar. A barbearia podera lembrar pelo WhatsApp informado.");
    } else {
      setMensagem("Notificacoes ativadas. Ao confirmar, vamos salvar este aparelho para receber lembretes.");
    }

    setNotificacaoRespondida(true);
    rolarParaProximaEtapa();
  }

  async function salvarInscricaoPush(clienteId: number, agendamentoId: number) {
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    if (!aceitaLembrete || !vapidPublicKey || Notification.permission !== "granted") {
      return false;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return false;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    const inscricaoAtual = await registration.pushManager.getSubscription();
    const subscription =
      inscricaoAtual ||
      (await registration.pushManager.subscribe({
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        userVisibleOnly: true,
      }));

    await fetch("/api/push-subscriptions", {
      body: JSON.stringify({
        agendamentoId,
        clienteId,
        empresaId,
        subscription: subscription.toJSON(),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  }

  async function confirmarAgendamento() {
    const nomeLimpo = nome.trim();
    const telefoneLimpo = normalizarTelefoneBrasil(telefone);

    if (!isSupabaseConfigured) {
      setMensagem("Agendamento indisponivel. Supabase nao configurado.");
      return;
    }

    if (!nomeLimpo || !telefoneLimpo || !servicoId || !data || !horario) {
      setMensagem("Preencha telefone, nascimento, servico, dia e horario para confirmar.");
      return;
    }

    if (!telefoneBrasilValido(telefoneLimpo)) {
      setMensagem("Informe um WhatsApp valido com DDD. Exemplo: 18999998888.");
      return;
    }

    if (ocupados.includes(horario)) {
      setMensagem("Esse horario ja foi reservado. Escolha outro horario.");
      return;
    }

    if (horarioJaPassou(data, horario)) {
      setMensagem("Esse horario ja passou. Escolha outro dia ou um horario mais tarde.");
      return;
    }

    setSalvando(true);
    setMensagem("Confirmando seu agendamento...");

    const response = await fetch("/api/public-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aceitaLembrete,
        data,
        dataNascimento: dataNascimento || null,
        empresa: empresaId,
        hora: horario,
        nome: nomeLimpo,
        profissionalId,
        servicoId,
        telefone: telefoneLimpo,
      }),
    });
    const resultado = await response.json().catch(() => null);

    if (!response.ok || !resultado?.agendamentoId || !resultado?.clienteId) {
      setSalvando(false);
      setMensagem(resultado?.error || "Erro ao confirmar agendamento. Tente novamente.");
      return;
    }

    setSalvando(false);
    setAgendamentoIdConfirmado(resultado.agendamentoId);
    setAgendamentoConcluido(true);
    setMensagem(
      aceitaLembrete
        ? "Agendamento confirmado! Estamos testando a notificacao neste aparelho."
        : "Agendamento confirmado! A barbearia recebeu sua reserva.",
    );
    rolarParaProximaEtapa();

    if (aceitaLembrete) {
      salvarInscricaoPush(resultado.clienteId, resultado.agendamentoId)
        .then((notificacoesEnviadas) => {
          if (notificacoesEnviadas) {
            setMensagem("Agendamento confirmado! Enviamos uma notificacao de teste para este aparelho.");
          }
        })
        .catch((pushError) => {
          const detalhe = pushError instanceof Error ? pushError.message : "Nao conseguimos ativar o push.";
          setMensagem(`Agendamento confirmado! ${detalhe} A barbearia recebeu sua reserva.`);
        });
    }
  }

  async function buscarAgendamentosCliente() {
    const digits = telefoneCancelamento.replace(/\D/g, "");
    if (digits.length < 10) {
      setMensagem("Informe um WhatsApp valido com DDD.");
      return;
    }
    const telCom55 = normalizarTelefoneBrasil(telefoneCancelamento);
    setMensagem("");
    setBuscandoAgendamentos(true);

    const params = new URLSearchParams({
      empresa: String(empresaId),
      scope: "future",
      telefone: telCom55,
    });
    const response = await fetch(`/api/public-appointments?${params.toString()}`, { cache: "no-store" });
    const resultado = await response.json().catch(() => null);
    const ags = response.ok && Array.isArray(resultado?.appointments) ? resultado.appointments : null;

    setBuscandoAgendamentos(false);

    if (!response.ok || !ags || ags.length === 0) {
      setMensagem("Nenhum agendamento futuro encontrado.");
      return;
    }

    setAgendamentosCliente(ags);
  }

  async function buscarHistoricoCliente() {
    const digits = telefoneCancelamento.replace(/\D/g, "");
    if (digits.length < 10) return;

    const telCom55 = normalizarTelefoneBrasil(telefoneCancelamento);
    setBuscandoHistorico(true);

    const params = new URLSearchParams({
      empresa: String(empresaId),
      scope: "history",
      telefone: telCom55,
    });
    const response = await fetch(`/api/public-appointments?${params.toString()}`, { cache: "no-store" });
    const resultado = await response.json().catch(() => null);
    const ags = response.ok && Array.isArray(resultado?.appointments) ? resultado.appointments : [];

    setBuscandoHistorico(false);
    setHistoricoCliente(ags);
  }

  function alternarHistorico() {
    const abrir = !mostrarHistorico;
    setMostrarHistorico(abrir);

    if (abrir && historicoCliente.length === 0) {
      buscarHistoricoCliente();
    }
  }

  async function cancelarAgendamentoCliente(id: number) {
    setCancelando(true);
    const response = await fetch("/api/public-appointments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa: empresaId, telefone: telefoneCancelamento, agendamentoId: id }),
    });
    const resultado = await response.json().catch(() => null);
    setCancelando(false);
    if (!response.ok) {
      setMensagem(resultado?.error || "Nao foi possivel cancelar. Tente novamente.");
      return;
    }
    setAgendamentosCliente((lista) => lista.filter((ag) => ag.id !== id));
    setMensagem("Agendamento cancelado com sucesso.");
  }

  async function cancelarAgendamento() {
    if (!agendamentoIdConfirmado) return;
    setCancelando(true);
    const response = await fetch("/api/public-appointments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa: empresaId, telefone, agendamentoId: agendamentoIdConfirmado }),
    });
    const resultado = await response.json().catch(() => null);

    setCancelando(false);

    if (!response.ok) {
      setMensagem(resultado?.error || "Nao foi possivel cancelar. Tente novamente ou entre em contato com a barbearia.");
      return;
    }

    setAgendamentoCancelado(true);
    setMensagem("");
  }

  return (
    <main className="chat-booking-page">
      <section className="chat-booking">
        <AssistantBubble wide>
          Ola, tudo bem? Sou a assistente virtual do(a) {barbeariaNome} e cuido do agendamento dos servicos, ok?
        </AssistantBubble>

        {!nomeConfirmado && !modoCancelamento && (
          <button
            className="chat-secondary-button cancel-entry-btn"
            onClick={() => setModoCancelamento(true)}
            type="button"
          >
            Cancelar um agendamento existente
          </button>
        )}

        {modoCancelamento && (
          <div className="cancel-lookup-panel">
            <p className="cancel-lookup-title">Informe seu WhatsApp para buscar seus agendamentos:</p>
            <div className="chat-input-stack">
              <input
                inputMode="tel"
                onChange={(e) => setTelefoneCancelamento(e.target.value)}
                placeholder="Ex: 18981518787"
                value={telefoneCancelamento}
              />
              <button
                className="chat-action-button"
                disabled={buscandoAgendamentos}
                onClick={buscarAgendamentosCliente}
                type="button"
              >
                {buscandoAgendamentos ? "Buscando..." : "Buscar"}
              </button>
            </div>
            {mensagem && <p className="chat-status">{mensagem}</p>}
            {agendamentosCliente.length > 0 && (
              <div className="cancel-list">
                {agendamentosCliente.map((ag) => (
                  <div className="cancel-item" key={ag.id}>
                    <div>
                      <strong>{ag.servico}</strong>
                      <span>{new Date(ag.data_agendamento).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                    <button
                      className="cancel-item-btn"
                      disabled={cancelando}
                      onClick={() => cancelarAgendamentoCliente(ag.id)}
                      type="button"
                    >
                      Cancelar
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="chat-secondary-button"
              onClick={() => { setModoCancelamento(false); setAgendamentosCliente([]); setMensagem(""); }}
              type="button"
            >
              Voltar
            </button>
          </div>
        )}

        {!modoCancelamento && (
        <AssistantBubble>Qual o seu nome? Escreva seu nome e sobrenome ou apelido, por favor.</AssistantBubble>
        )}

        {!modoCancelamento && !nomeConfirmado ? (
          <ChatInput
            buttonLabel="Enviar"
            onSubmit={() => {
              if (!nome.trim()) {
                setMensagem("Informe seu nome completo para continuar.");
                return;
              }

              setNomeConfirmado(true);
              setMensagem("");
              rolarParaProximaEtapa();
            }}
            onValueChange={setNome}
            placeholder="Seu nome e sobrenome"
            value={nome}
          />
        ) : !modoCancelamento ? (
          <UserBubble>{nome}</UserBubble>
        ) : null}

        {nomeConfirmado && !modoCancelamento && (
          <>
            <AssistantBubble>Como vai, {primeiroNome}! Tudo bem?</AssistantBubble>
            <AssistantBubble wide>
              Para que possamos lembra-lo de seu agendamento, ative suas notificacoes clicando abaixo:
            </AssistantBubble>

            {!notificacaoRespondida ? (
              <div className="chat-action-stack">
                <button className="chat-action-button" onClick={pedirNotificacao} type="button">
                  Ativar notificacoes
                </button>
                <button
                  className="chat-secondary-button"
                  onClick={() => {
                    setNotificacaoRespondida(true);
                    setAceitaLembrete(false);
                    rolarParaProximaEtapa();
                  }}
                  type="button"
                >
                  Pular
                </button>
              </div>
            ) : (
              <UserBubble>Continuar</UserBubble>
            )}
          </>
        )}

        {nomeConfirmado && notificacaoRespondida && (
          <>
            <AssistantBubble>Por qual servico voce esta procurando?</AssistantBubble>
            <p className="chat-section-label">Selecione os servicos:</p>

            {carregando ? (
              <div className="chat-empty">Carregando servicos...</div>
            ) : (
              <div className="chat-service-carousel">
                {servicos.map((servico, index) => (
                  <button
                    aria-pressed={servicoId === servico.id}
                    className="chat-service-card"
                    key={servico.id}
                    onClick={() => {
                      setServicoId(servico.id);
                      setServicoConfirmado(false);
                      setHorarioConfirmado(false);
                      rolarParaProximaEtapa();
                    }}
                    type="button"
                  >
                    <span className={`chat-service-image service-tone-${index % 4}`} />
                    <span className="chat-service-info">
                      <strong>{servico.nome}</strong>
                      <span>{moeda.format(servico.preco)}</span>
                      <em>{servico.duracao || 30}min</em>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <button
              className="chat-action-button"
              disabled={!servicoId}
              onClick={() => {
                setServicoConfirmado(true);
                rolarParaProximaEtapa();
              }}
              type="button"
            >
              Enviar
            </button>
          </>
        )}

        {servicoConfirmado && servicoSelecionado && (
          <>
            <UserBubble>{servicoSelecionado.nome}</UserBubble>
            <AssistantBubble>Certo, e qual o melhor dia e horario para voce ser atendido?</AssistantBubble>
            <p className="chat-section-label">Selecione o dia e horario:</p>

            <div className="chat-day-carousel">
              {diasAgenda.map((dia) => (
                <button
                  aria-pressed={data === dia.valor}
                  className="chat-day-card"
                  key={dia.valor}
                  onClick={() => {
                    setData(dia.valor);
                    setHorario("");
                    setHorarioConfirmado(false);
                    rolarParaProximaEtapa();
                  }}
                  type="button"
                >
                  <span>{dia.semana}</span>
                  <strong>{dia.label}</strong>
                  <em>{dia.mes}</em>
                </button>
              ))}
            </div>

            {horariosValidos.length === 0 ? (
              <div className="chat-empty">Nao ha horarios disponiveis para este dia. Escolha outro dia.</div>
            ) : (
              <div className="chat-time-grid">
                {horariosValidos.map((hora) => {
                  const indisponivel = ocupados.includes(hora);

                  return (
                    <button
                      aria-pressed={horario === hora}
                      className="chat-time-button"
                      disabled={indisponivel}
                      key={hora}
                      onClick={() => {
                        setHorario(hora);
                        setHorarioConfirmado(false);
                        rolarParaProximaEtapa();
                      }}
                      type="button"
                    >
                      {indisponivel ? `${hora} ocupado` : hora}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              className="chat-action-button"
              disabled={!data || !horario}
              onClick={() => {
                setHorarioConfirmado(true);
                rolarParaProximaEtapa();
              }}
              type="button"
            >
              Enviar
            </button>
          </>
        )}

        {horarioConfirmado && (
          <>
            <UserBubble>
              {diaSelecionado?.label || data} - {horario}
            </UserBubble>
            <AssistantBubble wide>
              Perfeito. Para finalizar, informe seu WhatsApp e sua data de nascimento.
            </AssistantBubble>

            <div className="chat-final-form">
              <label className="chat-final-label">
                WhatsApp com DDD
                <input
                  inputMode="tel"
                  onChange={(event) => setTelefone(event.target.value)}
                  placeholder="Ex: 18981518787"
                  value={telefone}
                />
              </label>
              <label className="chat-final-label">
                Data de nascimento
                <input
                  onChange={(event) => setDataNascimento(event.target.value)}
                  type="date"
                  value={dataNascimento}
                />
              </label>
            </div>

            <button className="chat-action-button" disabled={salvando} onClick={confirmarAgendamento} type="button">
              {salvando ? "Confirmando..." : "Confirmar agendamento"}
            </button>
          </>
        )}

        {mensagem && !agendamentoConcluido && !modoCancelamento && <p className="chat-status">{mensagem}</p>}
        <div ref={fimDoFluxoRef} />
      </section>

      {agendamentoConcluido && (
        <div className="booking-success-overlay">
          <div className="booking-success-card">
            {agendamentoCancelado ? (
              <>
                <span className="booking-success-icon cancel">✕</span>
                <h2>Agendamento cancelado</h2>
                <p>Esperamos te ver em breve na {barbeariaNome}!</p>
              </>
            ) : (
              <>
                <span className="booking-success-icon">✓</span>
                <h2>{barbeariaNome}</h2>
                <p>agradece o seu agendamento!</p>
                <div className="booking-success-detail">
                  <strong>{servicoSelecionado?.nome}</strong>
                  <span>{diaSelecionado?.label} {diaSelecionado?.mes} às {horario}</span>
                </div>
                {mensagem && <p className="booking-success-error">{mensagem}</p>}
                <button
                  className="booking-cancel-btn"
                  disabled={cancelando}
                  onClick={cancelarAgendamento}
                  type="button"
                >
                  {cancelando ? "Cancelando..." : "Cancelar agendamento"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function AssistantBubble({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "chat-bubble assistant wide" : "chat-bubble assistant"}>{children}</div>;
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return <div className="chat-bubble user">{children}</div>;
}

function ChatInput({
  buttonLabel,
  onSubmit,
  onValueChange,
  placeholder,
  value,
}: {
  buttonLabel: string;
  onSubmit: () => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="chat-input-stack">
      <input onChange={(event) => onValueChange(event.target.value)} placeholder={placeholder} value={value} />
      <button className="chat-action-button" onClick={onSubmit} type="button">
        {buttonLabel}
      </button>
    </div>
  );
}
