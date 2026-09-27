// Corpo enviado para /api/public-booking.
// aceitaLembrete = consentimento de WhatsApp marcado pelo cliente no proprio agendamento.
// Permissao de notificacao/push do navegador nao entra aqui: e outro canal, com inscricao propria.
export function montarPedidoAgendamentoPublico(dados: {
  aceitaLembreteWhatsApp: boolean;
  data: string;
  dataNascimento: string;
  empresa: string | number;
  hora: string;
  nome: string;
  profissionalId: number | null;
  servicoId: number;
  telefone: string;
}) {
  return {
    aceitaLembrete: dados.aceitaLembreteWhatsApp === true,
    data: dados.data,
    dataNascimento: dados.dataNascimento || null,
    empresa: dados.empresa,
    hora: dados.hora,
    nome: dados.nome,
    profissionalId: dados.profissionalId,
    servicoId: dados.servicoId,
    telefone: dados.telefone,
  };
}
