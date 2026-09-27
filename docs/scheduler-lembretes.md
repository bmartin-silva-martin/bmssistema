# Scheduler dos lembretes (pg_cron + pg_net) — PROPOSTA, NÃO APLICADA

Vercel Hobby só permite cron diário; o `vercel.json` continua com `0 11 * * *` (fallback, idempotente).
A cada 15 min o Supabase chama a rota oficial:

```
GET https://bmssistema-sss2.vercel.app/api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

Só o domínio oficial de Production. Nunca Preview, o projeto `bmssistema` legado, a branch `main` ou URLs temporárias.

## Pré-requisitos (ordem)

1. Deploy desta branch em Production (rota com a comparação em tempo constante).
2. Migration `20260927190000_create_mensagens_whatsapp.sql` aplicada. Sem ela a rota responde 500.
3. `CRON_SECRET`: o valor da Vercel é *Sensitive* e não pode ser lido de volta. Gerar um novo valor, gravar na Vercel
   (Production), fazer o redeploy e gravar o mesmo valor no Vault (passo 2 abaixo). O valor nunca entra em arquivo versionado.

## 0. Verificação somente leitura (SQL Editor)

```sql
select name, default_version, installed_version
from pg_available_extensions
where name in ('pg_cron', 'pg_net', 'supabase_vault');
```

## 1. Extensões

```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- supabase_vault já vem habilitada nos projetos Supabase.
```

## 2. Segredo (executar à mão no SQL Editor; NÃO versionar, NÃO colar em chat/log)

```sql
select vault.create_secret('<VALOR_DO_CRON_SECRET>', 'lembretes_cron_secret', 'Bearer da rota /api/cron/reminders');

-- Rotação:
-- select vault.update_secret(
--   (select id from vault.secrets where name = 'lembretes_cron_secret'),
--   '<NOVO_VALOR>'
-- );
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

## 4. Observabilidade

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
