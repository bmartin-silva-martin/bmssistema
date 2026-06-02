alter table empresas
add column if not exists licenca_install_id text,
add column if not exists licenca_expires_at timestamptz,
add column if not exists licenca_grace_days integer not null default 3,
add column if not exists licenca_last_nonce text;

update empresas
set licenca_install_id = coalesce(licenca_install_id, gen_random_uuid()::text),
    licenca_expires_at = coalesce(licenca_expires_at, now() + interval '33 days'),
    licenca_grace_days = coalesce(licenca_grace_days, 3)
where licenca_install_id is null
   or licenca_expires_at is null
   or licenca_grace_days is null;

create unique index if not exists empresas_licenca_install_id_unique_idx
on empresas (licenca_install_id)
where licenca_install_id is not null;

-- Use este bloco ao criar uma empresa nova.
-- Troque os dados e cole o UID do usuario criado em Authentication > Users.
--
-- insert into empresas (
--   nome,
--   slug,
--   plano,
--   ativo,
--   nome_responsavel,
--   owner_user_id,
--   licenca_install_id,
--   licenca_expires_at,
--   licenca_grace_days
-- )
-- values (
--   'Brothers Barber',
--   'brothers-barber',
--   'premium',
--   true,
--   'Bruno',
--   'COLE_O_USER_UID_AQUI',
--   gen_random_uuid()::text,
--   now() + interval '33 days',
--   3
-- );
