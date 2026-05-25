"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const EMPRESA_ID = 1;
const HORARIOS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];
const DATA_MINIMA = new Date().toISOString().slice(0, 10);
const moeda = new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" });

type Servico = {
  id: number;
  nome: string;
  preco: number;
  duracao: number | null;
};

type HorarioOcupado = {
  data_agendamento: string;
};

export default function AgendamentoPublicoPage() {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [ocupados, setOcupados] = useState<string[]>([]);
  const [servicoId, setServicoId] = useState<number | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [data, setData] = useState("");
  const [horario, setHorario] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const servicoSelecionado = servicos.find((servico) => servico.id === servicoId);

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

  async function confirmarAgendamento() {
    const nomeLimpo = nome.trim();
    const telefoneLimpo = telefone.trim();

    if (!isSupabaseConfigured) {
      setMensagem("Agendamento indisponivel. Supabase nao configurado.");
      return;
    }

    if (!nomeLimpo || !telefoneLimpo || !servicoId || !data || !horario) {
      setMensagem("Preencha todos os campos para confirmar.");
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
    setNome("");
    setTelefone("");
    setDataNascimento("");
    setServicoId(null);
    setData("");
    setHorario("");
    setOcupados([]);
  }

  return (
    <main className="booking-page public-booking-page">
      <section className="booking-panel public-booking-panel">
        <div className="section-heading stacked">
          <div>
            <p className="eyebrow">Barber Brothers</p>
            <h1>Agende seu horario</h1>
            <p className="muted">Escolha o servico, informe seus dados e reserve seu horario online.</p>
          </div>
        </div>

        {!isSupabaseConfigured && (
          <p className="notice notice-error">Agendamento indisponivel. Supabase nao configurado no sistema.</p>
        )}

        {carregando ? (
          <div className="empty-state">Carregando servicos...</div>
        ) : (
          <>
            <div className="form-stack">
              <label>
                Seu nome
                <input onChange={(event) => setNome(event.target.value)} placeholder="Nome completo" value={nome} />
              </label>

              <label>
                WhatsApp
                <input
                  inputMode="tel"
                  onChange={(event) => setTelefone(event.target.value)}
                  placeholder="(00) 00000-0000"
                  value={telefone}
                />
              </label>

              <label>
                Data de nascimento
                <input
                  onChange={(event) => setDataNascimento(event.target.value)}
                  type="date"
                  value={dataNascimento}
                />
              </label>
            </div>

            <section className="choice-section">
              <h2>Servico</h2>
              <div className="choice-grid">
                {servicos.map((servico) => (
                  <button
                    aria-pressed={servicoId === servico.id}
                    className="choice-button"
                    key={servico.id}
                    onClick={() => setServicoId(servico.id)}
                    type="button"
                  >
                    <strong>{servico.nome}</strong>
                    <span>
                      {moeda.format(servico.preco)} - {servico.duracao || 30} min
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <div className="form-stack">
              <label>
                Data
                <input
                  min={DATA_MINIMA}
                  onChange={(event) => {
                    const novaData = event.target.value;
                    setData(novaData);
                    setHorario("");
                    if (!novaData) setOcupados([]);
                  }}
                  type="date"
                  value={data}
                />
              </label>
            </div>

            <section className="choice-section">
              <h2>Horario</h2>
              <div className="hour-grid">
                {HORARIOS.map((hora) => {
                  const indisponivel = ocupados.includes(hora);

                  return (
                    <button
                      aria-pressed={horario === hora}
                      className="choice-button hour-button"
                      disabled={indisponivel}
                      key={hora}
                      onClick={() => setHorario(hora)}
                      type="button"
                    >
                      <strong>{hora}</strong>
                      <span>{indisponivel ? "Indisponivel" : "Disponivel"}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="booking-summary">
              <strong>Resumo</strong>
              <span>{servicoSelecionado?.nome || "Escolha um servico"}</span>
              <span>{data && horario ? `${data} as ${horario}` : "Escolha data e horario"}</span>
            </section>

            <button
              className="button button-primary wide"
              disabled={salvando || !isSupabaseConfigured}
              onClick={confirmarAgendamento}
              type="button"
            >
              {salvando ? "Confirmando..." : "Confirmar agendamento"}
            </button>
          </>
        )}

        {mensagem && <p className="status-message">{mensagem}</p>}
      </section>
    </main>
  );
}
