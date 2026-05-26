"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const EMPRESA_ID = 1;
const BARBEARIA_NOME = "Barbearia Teste";
const HORARIOS = [
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

function montarDiasAgenda() {
  const hoje = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + index);

    return {
      dia: String(data.getDate()).padStart(2, "0"),
      label: index === 0 ? "HOJE" : String(data.getDate()).padStart(2, "0"),
      mes: meses[data.getMonth()],
      semana: diasSemana[data.getDay()],
      valor: data.toISOString().slice(0, 10),
    };
  });
}

const DIAS_AGENDA = montarDiasAgenda();

export default function AgendamentoPublicoPage() {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [ocupados, setOcupados] = useState<string[]>([]);
  const [servicoId, setServicoId] = useState<number | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [data, setData] = useState(DIAS_AGENDA[0]?.valor || "");
  const [horario, setHorario] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [nomeConfirmado, setNomeConfirmado] = useState(false);
  const [notificacaoRespondida, setNotificacaoRespondida] = useState(false);
  const [servicoConfirmado, setServicoConfirmado] = useState(false);
  const [horarioConfirmado, setHorarioConfirmado] = useState(false);
  const fimDoFluxoRef = useRef<HTMLDivElement | null>(null);

  const primeiroNome = nome.trim().split(" ")[0] || "tudo bem";
  const servicoSelecionado = servicos.find((servico) => servico.id === servicoId);
  const diaSelecionado = useMemo(() => DIAS_AGENDA.find((dia) => dia.valor === data), [data]);

  function rolarParaProximaEtapa() {
    window.setTimeout(() => {
      fimDoFluxoRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 120);
  }

  const carregarServicos = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    const { data: lista, error } = await supabase
      .from("servicos")
      .select("id,nome,preco,duracao")
      .eq("empresa_id", EMPRESA_ID)
      .order("preco", { ascending: false });

    if (error) {
      setMensagem(`Erro ao carregar servicos: ${error.message}`);
      return;
    }

    setServicos(lista || []);
  }, []);

  const carregarHorariosOcupados = useCallback(async () => {
    if (!isSupabaseConfigured || !data) return;

    const inicio = `${data} 00:00:00`;
    const fim = `${data} 23:59:59`;

    const { data: lista, error } = await supabase
      .from("agendamentos")
      .select("data_agendamento")
      .eq("empresa_id", EMPRESA_ID)
      .neq("status", "cancelado")
      .gte("data_agendamento", inicio)
      .lte("data_agendamento", fim);

    if (error) {
      setMensagem(`Erro ao carregar horarios: ${error.message}`);
      return;
    }

    setOcupados(((lista || []) as HorarioOcupado[]).map((item) => item.data_agendamento.slice(11, 16)));
  }, [data]);

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

  async function pedirNotificacao() {
    if ("Notification" in window) {
      await Notification.requestPermission();
    }

    setNotificacaoRespondida(true);
    rolarParaProximaEtapa();
  }

  async function confirmarAgendamento() {
    const nomeLimpo = nome.trim();
    const telefoneLimpo = telefone.trim();

    if (!isSupabaseConfigured) {
      setMensagem("Agendamento indisponivel. Supabase nao configurado.");
      return;
    }

    if (!nomeLimpo || !telefoneLimpo || !servicoId || !data || !horario) {
      setMensagem("Preencha telefone, nascimento, servico, dia e horario para confirmar.");
      return;
    }

    if (ocupados.includes(horario)) {
      setMensagem("Esse horario ja foi reservado. Escolha outro horario.");
      return;
    }

    setSalvando(true);
    setMensagem("Confirmando seu agendamento...");

    const { data: cliente, error: erroCliente } = await supabase
      .from("clientes")
      .insert({
        data_nascimento: dataNascimento || null,
        empresa_id: EMPRESA_ID,
        nome: nomeLimpo,
        telefone: telefoneLimpo,
      })
      .select("id")
      .single();

    if (erroCliente) {
      setSalvando(false);
      setMensagem(`Erro ao criar cadastro: ${erroCliente.message}`);
      return;
    }

    const { error } = await supabase.from("agendamentos").insert({
      cliente_id: cliente.id,
      data_agendamento: `${data} ${horario}:00`,
      empresa_id: EMPRESA_ID,
      servico_id: servicoId,
      status: "confirmado",
    });

    setSalvando(false);

    if (error) {
      setMensagem(`Erro ao confirmar agendamento: ${error.message}`);
      return;
    }

    setMensagem("Agendamento confirmado! A barbearia recebeu sua reserva.");
    rolarParaProximaEtapa();
  }

  return (
    <main className="chat-booking-page">
      <section className="chat-booking">
        <AssistantBubble wide>
          Ola, tudo bem? Sou a assistente virtual do(a) {BARBEARIA_NOME} e cuido do agendamento dos servicos, ok?
        </AssistantBubble>

        <AssistantBubble>Qual o seu nome? Escreva seu nome e sobrenome, por favor.</AssistantBubble>

        {!nomeConfirmado ? (
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
        ) : (
          <UserBubble>{nome}</UserBubble>
        )}

        {nomeConfirmado && (
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
              {DIAS_AGENDA.map((dia) => (
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

            <div className="chat-time-grid">
              {HORARIOS.map((hora) => {
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
                    {hora}
                  </button>
                );
              })}
            </div>

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
              <input
                inputMode="tel"
                onChange={(event) => setTelefone(event.target.value)}
                placeholder="Seu WhatsApp"
                value={telefone}
              />
              <input
                onChange={(event) => setDataNascimento(event.target.value)}
                type="date"
                value={dataNascimento}
              />
            </div>

            <button className="chat-action-button" disabled={salvando} onClick={confirmarAgendamento} type="button">
              {salvando ? "Confirmando..." : "Confirmar agendamento"}
            </button>
          </>
        )}

        {mensagem && <p className="chat-status">{mensagem}</p>}
        <div ref={fimDoFluxoRef} />
      </section>
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
