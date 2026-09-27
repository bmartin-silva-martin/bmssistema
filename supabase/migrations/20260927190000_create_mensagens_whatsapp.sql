-- Registro/fila dos lembretes (WhatsApp e push) e log dos lembretes manuais.
-- A idempotencia vem do indice unico (agendamento_id, tipo, canal) dos lembretes automaticos:
-- quem insere primeiro reserva o envio. manual_reminder e apenas log (varias linhas permitidas).
-- Escrita somente server-side (service role). O dono da empresa apenas le as proprias mensagens.

-- O lembrete do dia depende de agendamentos.created_at (nao envia para agendamento criado no dia).
-- A coluna nao esta versionada neste repositorio; abortar aqui evita publicar codigo com premissa falsa.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agendamentos'
      and column_name = 'created_at'
  ) then
    raise exception 'public.agendamentos.created_at nao existe; lembrete do dia depende dessa coluna.';
  end if;
end $$;

create table if not exists public.mensagens_whatsapp (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('reminder_day', 'reminder_2h', 'manual_reminder', 'waitlist_offer')),
  -- Canais independentes: falha/ausencia de um nao bloqueia o outro.
  canal text not null default 'whatsapp' check (canal in ('whatsapp', 'push')),
  agendamento_id bigint references public.agendamentos(id) on delete cascade,
  -- FK sera adicionada junto com a tabela de ofertas da lista de espera.
  oferta_id bigint,
  status text not null default 'processando'
    check (status in ('processando', 'enviado', 'erro', 'incerto', 'falha_definitiva', 'ignorado')),
  tentativas integer not null default 1 check (tentativas >= 0),
  ultimo_erro text,
  claimed_at timestamptz default now(),
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint mensagens_whatsapp_alvo_check check (
    (tipo in ('reminder_day', 'reminder_2h', 'manual_reminder') and agendamento_id is not null and oferta_id is null)
    or (tipo = 'waitlist_offer' and oferta_id is not null and agendamento_id is null)
  ),
  constraint mensagens_whatsapp_oferta_key unique (oferta_id)
);

create unique index if not exists mensagens_whatsapp_lembrete_canal_key
  on public.mensagens_whatsapp (agendamento_id, tipo, canal)
  where tipo in ('reminder_day', 'reminder_2h');

create index if not exists mensagens_whatsapp_manual_idx
  on public.mensagens_whatsapp (agendamento_id, enviado_em desc)
  where tipo = 'manual_reminder';

create index if not exists mensagens_whatsapp_empresa_created_idx
  on public.mensagens_whatsapp (empresa_id, created_at desc);

alter table public.mensagens_whatsapp enable row level security;

revoke all on table public.mensagens_whatsapp from anon, authenticated;
grant select on table public.mensagens_whatsapp to authenticated;

drop policy if exists "mensagens_whatsapp_authenticated_select" on public.mensagens_whatsapp;
create policy "mensagens_whatsapp_authenticated_select"
  on public.mensagens_whatsapp
  for select
  to authenticated
  using (
    empresa_id in (
      select id
      from public.empresas
      where owner_user_id = auth.uid()
    )
  );

comment on table public.mensagens_whatsapp is
  'Lembretes por canal (reminder_day, reminder_2h: uma linha por agendamento+tipo+canal), log de manual_reminder e waitlist_offer.';
