alter table empresas
add column if not exists slug text,
add column if not exists owner_user_id uuid references auth.users(id),
add column if not exists nome_responsavel text,
add column if not exists configuracoes jsonb not null default '{}'::jsonb;

create unique index if not exists empresas_slug_unique_idx
on empresas (slug)
where slug is not null;

create index if not exists empresas_owner_user_id_idx
on empresas (owner_user_id);

update empresas
set slug = lower(regexp_replace(regexp_replace(nome, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
where slug is null
  and nome is not null;

-- Exemplo de cadastro de nova barbearia:
-- 1. Crie o usuario em Authentication > Users no Supabase.
-- 2. Copie o ID do usuario criado.
-- 3. Rode um insert como este, trocando nome, slug e owner_user_id:
--
-- insert into empresas (nome, slug, plano, ativo, nome_responsavel, owner_user_id)
-- values ('Brothers Barber', 'brothers-barber', 'premium', true, 'Bruno', 'ID_DO_USUARIO_AQUI');
--
-- Link publico:
-- https://SEU-DOMINIO/agendamentos?empresa=brothers-barber
