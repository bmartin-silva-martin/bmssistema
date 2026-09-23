alter table public.servicos
  add column if not exists precos_por_dia jsonb;

comment on column public.servicos.precos_por_dia is
  'Precos por dia da semana (0=domingo..6=sabado), opcional. Chave ausente ou nula usa o preco base.';
