# Scheduler dos lembretes (pg_cron + pg_net) — extensões instaladas; segredo, migration e job NÃO aplicados

Vercel Hobby só permite cron diário, então o cron da Vercel foi removido (o `vercel.json` só tinha ele). O único
scheduler é o Supabase, que a cada 15 min chama a rota oficial:

```
GET https://bmssistema-sss2.vercel.app/api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

Só o domínio oficial de Production. Nunca Preview, o projeto `bmssistema` legado, a branch `main` ou URLs temporárias.

## Ordem oficial de ativação

1. Gerar um novo `CRON_SECRET` (seção 2).
2. Gravar na Vercel: projeto `bmssistema-sss2`, **só Production**. A deployment atual continua com o valor antigo até o
   redeploy.
3. Gravar o mesmo valor no Vault (`lembretes_cron_secret`). Nada lê esse valor ainda.
4. Aplicar a migration `20260927190000_create_mensagens_whatsapp.sql`. O código em Production hoje não usa a tabela,
   então aplicá-la antes do deploy não muda nada. Aplicá-la depois quebraria a rota (500) e o log do lembrete manual.
5. Deploy desta branch em Production. Sem `vercel.json`, a Vercel remove o cron diário das 08:00. A deployment nova
   sobe com o `CRON_SECRET` novo.
6. Chamar a rota pelo pg_net com `?dryRun=1` (seção 4).
7. Confirmar HTTP 200, só contagens na resposta e zero efeito colateral (`mensagens_whatsapp` inalterada).
8. Criar o job de 15 min **pausado** (seção 3): um job ativo já atenderia clientes reais antes do teste do passo 9.
9. Primeiro envio real, só para o número de teste controlado (seção 5).
10. Ativar o job (`cron.alter_job(..., active := true)`). Só a partir daqui o scheduler atende clientes reais.

Nenhuma chamada automática acontece antes do passo 10. A Vercel deixa de agendar no deploy (5), e o job nasce pausado
(8). A tabela existe desde o passo 4.

**Atenção antes do passo 5:** até esse deploy, a deployment antiga continua com o cron diário das 08:00 e com o código
antigo de lembretes.

## 0. Verificação somente leitura (SQL Editor)

```sql
select name, default_version, installed_version
from pg_available_extensions
where name in ('pg_cron', 'pg_net', 'supabase_vault');
```

Resultado confirmado em 2026-09-27: pg_cron 1.6.4 e pg_net 0.20.0 disponíveis, nenhuma instalada.

## 1. Extensões (Fase 4A)

Habilitar só as extensões, sem job e sem segredo. Sozinhas elas não chamam nada.

```sql
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- O Supabase concede o schema net a anon/authenticated ao instalar o pg_net.
-- Somente o job (roda como postgres) precisa fazer requisições HTTP.
revoke usage on schema net from anon, authenticated;
revoke execute on all functions in schema net from anon, authenticated;

commit;
```

Conferência (somente leitura):

```sql
select extname, extversion from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault');
-- esperado: pg_cron 1.6.4, pg_net 0.20.0, supabase_vault

select count(*) as jobs from cron.job;
-- esperado: 0

-- Sem USAGE no schema net, anon/authenticated não chegam às funções,
-- mesmo que alguma tenha EXECUTE herdado de PUBLIC. has_schema_privilege já considera PUBLIC.
select rolname, has_schema_privilege(rolname, 'net', 'usage') as usa_net,
       has_schema_privilege(rolname, 'cron', 'usage') as usa_cron
from pg_roles
where rolname in ('anon', 'authenticated');
-- esperado: false em todas as colunas
```

Se `usa_net` ou `usa_cron` vier `true` (por exemplo, via PUBLIC), não seguir para o passo 2. Revisar os grants antes.

Reverter (só se ainda não houver job):

```sql
drop extension if exists pg_net;
drop extension if exists pg_cron;
```

O `supabase_vault` normalmente já vem instalado. Se a conferência não o listar, habilite-o em
Dashboard > Database > Extensions antes do passo 2.

## 2. Segredo (NÃO versionar, NÃO colar em chat/log/arquivo)

Gerar 32 bytes aleatórios (64 caracteres hex, sem caractere especial) direto para a área de transferência,
sem aparecer na tela:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | Set-Clipboard
```

Colar o mesmo valor em:

- Vercel > `bmssistema-sss2` > Settings > Environment Variables > `CRON_SECRET` > Edit (só **Production**, Sensitive).
- Supabase > Integrations > Vault > Add new secret: nome `lembretes_cron_secret`. Pela tela, o valor não fica no
  histórico do SQL Editor.

Depois, limpar a área de transferência (`Set-Clipboard -Value " "`). Se o histórico do Windows (Win+V) estiver ligado,
apagar o item de lá também.

Alternativa por SQL (idempotente; o texto executado fica no histórico do SQL Editor, então prefira a tela do Vault):

```sql
do $$
declare
  segredo_id uuid := (select id from vault.secrets where name = 'lembretes_cron_secret');
begin
  if segredo_id is null then
    perform vault.create_secret('<COLAR_AQUI>', 'lembretes_cron_secret', 'Bearer da rota /api/cron/reminders (Production)');
  else
    perform vault.update_secret(segredo_id, '<COLAR_AQUI>');
  end if;
end $$;
```

Conferência sem expor o valor:

```sql
select name, description, updated_at, length(decrypted_secret) as tamanho
from vault.decrypted_secrets
where name = 'lembretes_cron_secret';
-- esperado: 1 linha, tamanho = 64
```

O job lê o segredo do Vault a cada execução. Assim, `cron.job.command` não contém o segredo.

## 3. Job (idempotente)

`cron.schedule` com o mesmo nome atualiza o job existente em vez de criar outro.

```sql
-- Remove jobs antigos/duplicados que chamem a mesma rota com outro nome.
select cron.unschedule(jobid)
from cron.job
where command like '%/api/cron/reminders%'
  and jobname is distinct from 'lembretes-15min';

-- Criar e pausar na mesma transação: o pg_cron só enxerga o job depois do commit, já pausado.
begin;

select cron.schedule(
  'lembretes-15min',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://bmssistema-sss2.vercel.app/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lembretes_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'lembretes-15min'), active := false);

commit;

-- Conferência: 1 linha, active = false.
select jobid, jobname, schedule, active from cron.job where jobname = 'lembretes-15min';
```

Ativar (passo 10), só depois do teste real controlado:

```sql
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'lembretes-15min'), active := true);
```

- `timeout_milliseconds := 55000`: o padrão do pg_net é 5 s. A rota tem `maxDuration = 60` e orçamento interno de 45 s.
- Um job duplicado ou uma chamada sobreposta não duplica envio: a reserva é feita pelo índice único
  `(agendamento_id, tipo, canal)`. Os testes em `tests/cronReminders.test.mjs` cobrem chamadas concorrentes.
- Enquanto a requisição está na fila, o pg_net guarda os headers (inclusive o Bearer) em `net.http_request_queue`.
  A tabela é interna e só roles privilegiadas a leem. Não conceder acesso a `anon`/`authenticated`.

### Desligar

```sql
select cron.unschedule('lembretes-15min');
```

## 4. Dry run pelo pg_net (passos 6 e 7)

`?dryRun=1` exige o mesmo `CRON_SECRET`. A chamada só lê: calcula quem seria lembrado agora, não envia WhatsApp nem
push e não escreve nada no banco. A resposta traz só contagens, sem telefone, nome, serviço ou IDs:

```json
{"dryRun":true,"reminderDayEligible":2,"reminder2hEligible":1,"pushEligible":1,"verificados":8,"pushConfigured":true,"whatsappConfigured":true}
```

Qualquer `dryRun` na URL (`=1`, `=true`, `=0` ou sem valor) é tratado como dry run: na dúvida, nunca envia. Pode rodar em
qualquer horário.

```sql
-- Guardar os dois request_id.
select net.http_get(
  url := 'https://bmssistema-sss2.vercel.app/api/cron/reminders?dryRun=1',
  headers := jsonb_build_object(
    'Authorization',
    'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lembretes_cron_secret')
  ),
  timeout_milliseconds := 55000
) as request_id;

-- Negativo: precisa voltar 401.
select net.http_get(
  url := 'https://bmssistema-sss2.vercel.app/api/cron/reminders?dryRun=1',
  headers := '{"Authorization": "Bearer token-errado"}'::jsonb
) as request_id;

-- Alguns segundos depois.
select id, status_code, timed_out, error_msg, content
from net._http_response
where id in (<request_id_valido>, <request_id_errado>);

-- Zero efeito colateral: esperado 0 (tabela recém-criada).
select count(*) from public.mensagens_whatsapp;
```

Esperado:

- Chamada válida: `200`, `dryRun: true`, `whatsappConfigured: true`, `pushConfigured: true`.
- Chamada com token errado: `401`.
- `401` na válida: o Vault e a Vercel têm valores diferentes.
- `500`: conferir a migration e as variáveis do Supabase.

A Evolution não é chamada no dry run. Versão, instância e payload v2 só se confirmam no envio real controlado (seção 5).

## 5. Primeiro envio real controlado (passo 9) — NÃO executar antes da hora

Objetivo: exatamente 1 WhatsApp, para um telefone do Bruno, com o job ainda pausado. Isso confirma a Evolution v2, a
instância conectada, o payload, o texto, o horário local, o nome da empresa e o serviço/profissional.

1. No painel, criar um agendamento de teste: cliente "Teste Bruno", telefone do Bruno, serviço e profissional reais,
   **"Enviar lembretes por WhatsApp" marcado**. Horário **hoje, 60 a 120 min à frente**, dentro da janela do lembrete
   de 2h (30 a 130 min). O lembrete do dia não vale para agendamento criado no mesmo dia, então só sai o de 2h. O
   cliente de teste não tem inscrição push.
2. Rodar o dry run (seção 4). Seguir **somente** se vier `reminder2hEligible: 1`, `reminderDayEligible: 0` e
   `pushEligible: 0`. Qualquer outro número significa que clientes reais seriam atingidos: esperar outro horário.
3. Logo em seguida, a mesma chamada **sem** `?dryRun=1` (uma vez só).
4. Conferir:
   - resposta com `whatsapp.enviados: 1` e `push.enviados: 0`;
   - `select tipo, canal, status, ultimo_erro from public.mensagens_whatsapp;` com 1 linha
     `reminder_2h / whatsapp / enviado`;
   - no celular: texto, horário, empresa, serviço e profissional.
5. Diagnóstico pelo `ultimo_erro`:
   - `HTTP 400.` = payload incompatível (Evolution não é v2): parar;
   - `HTTP 401/403/404` = chave ou instância: conferir as variáveis `EVOLUTION_*` na Vercel;
   - `Falha: timeout.` = status `incerto`, não reenvia sozinho.
6. Cancelar o agendamento de teste no painel.
7. Só então o passo 10 (ativar o job).

## 6. Observabilidade

Nenhuma dessas consultas mostra telefone, texto ou segredo. A resposta da rota só tem contadores
(teste: "resposta (gravada pelo pg_net) nao expoe telefone, texto nem segredos").

```sql
-- Última execução / scheduler parado: alerta se max(start_time) tiver mais de 30 min.
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'lembretes-15min')
order by start_time desc
limit 20;

-- Job ativo e sem duplicados: esperado exatamente 1 linha, active = true.
select jobid, jobname, schedule, active
from cron.job
where command like '%/api/cron/reminders%';

-- HTTP status, timeout e resumo. pg_net guarda as respostas por ~6 h.
-- 401 = segredo divergente entre Vault e Vercel; 500 = Supabase ou migration ausente.
select created, status_code, timed_out, error_msg, left(content::text, 400) as resumo
from net._http_response
order by created desc
limit 20;

-- Mensagens processadas e erros nas últimas 24 h
-- (ultimo_erro guarda só "HTTP 500." / "Falha: timeout.").
select canal, tipo, status, count(*), max(ultimo_erro) as exemplo_erro
from public.mensagens_whatsapp
where created_at > now() - interval '24 hours'
group by canal, tipo, status
order by canal, tipo, status;

-- Envio duplicado (esperado: 0 linhas).
select agendamento_id, tipo, canal, count(*)
from public.mensagens_whatsapp
where tipo in ('reminder_day', 'reminder_2h')
group by agendamento_id, tipo, canal
having count(*) > 1;
```

Nos logs da Vercel a rota só registra `[lembretes] Evolution API recusou configuracao (HTTP nnn)`, sem dados do cliente.
