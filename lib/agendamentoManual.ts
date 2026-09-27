export type FormNovoAgendamento = {
  // Consentimento do lembrete automatico por WhatsApp. Comeca desmarcado: nunca presumir.
  aceitaLembrete: boolean;
  clienteNome: string;
  clienteTelefone: string;
  data: string;
  horario: string;
  profissionalId: string;
  servicoId: string;
};

export function formNovoAgendamentoInicial(data: string): FormNovoAgendamento {
  return {
    aceitaLembrete: false,
    clienteNome: "",
    clienteTelefone: "",
    data,
    horario: "",
    profissionalId: "",
    servicoId: "",
  };
}

// aceita_lembrete sempre vai explicito no insert, sem depender do default da coluna.
// clientes.aceita_lembrete nao e herdado: o consentimento fica registrado no proprio agendamento.
export function montarAgendamentoManual(dados: {
  clienteId: number;
  empresaId: number;
  form: Pick<FormNovoAgendamento, "aceitaLembrete" | "data" | "horario">;
  profissionalId: number | null;
  servicoId: number;
}) {
  return {
    aceita_lembrete: dados.form.aceitaLembrete === true,
    cliente_id: dados.clienteId,
    data_agendamento: `${dados.form.data} ${dados.form.horario}:00`,
    empresa_id: dados.empresaId,
    profissional_id: dados.profissionalId,
    servico_id: dados.servicoId,
    status: "confirmado",
  };
}
