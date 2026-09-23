# Future Features Preserved from Legacy Stash

Documented from `stash@{0}: wip-before-ui-redesign-merge-20260923-195852`.

This document records future requirements found in the legacy stash without restoring its old application code or executing its SQL files.

## 1. Forma de pagamento

Origin: `supabase_forma_pagamento.sql`.

### Requirement

Add complete support for `vendas.forma_pagamento`:

- the sale-closing flow must save the payment method;
- financial queries must select the field;
- reports must consume the value consistently.

### Current state

The current financial area has partial logic for reading and aggregating `forma_pagamento`, but the sale-closing flow does not save it and the current sales query does not select it correctly.

### Future implementation

- create a versioned Supabase migration;
- add the field to the sale-closing flow;
- validate accepted payment methods;
- include the field in financial reads and reports;
- add automated tests for persistence, filtering, and aggregation.

Priority: **HIGH**.

Risks: inconsistent historical reports, invalid free-form values, and schema drift if the UI and migration are released separately.

## 2. Configurable reminder lead time

Origin: `supabase_lembrete_antecedencia.sql`.

### Proposed field

`empresas.lembrete_antecedencia_minutos`.

### Current state

- the cron currently uses a fixed 120-minute default;
- `company-profile` does not read or write this field;
- the current UI has no configuration for it.

### Future implementation

This feature must be implemented as one coordinated change:

- versioned migration;
- `company-profile` read/write support;
- settings UI;
- validation and allowed-range rules;
- cron consumption;
- safe fallback/default behavior when the value is null or unavailable.

Do not implement only the database field or only the UI. Partial implementation could create a setting that appears to work while the cron ignores it.

Priority: **MEDIUM**.

Risks: reminders sent too early or too late, inconsistent behavior between companies, and accidental changes to the current 120-minute behavior.

## 3. Structured company address

Origins:

- `supabase_empresa_endereco_estruturado.sql`;
- `supabase_endereco.sql`.

### Fields identified

- `endereco`;
- `numero`;
- `complemento`;
- `bairro`;
- `cidade`;
- `estado`;
- `capa_url`.

### Current state

- the current principal does not consume these fields;
- the public flow does not depend on them;
- older UI code contained address/profile screens, but that UI was replaced by the current redesign.

### Future implementation

- define the final data model first;
- create **one consolidated migration**;
- do not execute the two legacy SQL files separately;
- update `company-profile` with explicit schema support;
- add the corresponding settings UI;
- expose address data publicly only if a confirmed product requirement needs it;
- add validation for URLs, state values, and field lengths.

Priority: **LOW/MEDIUM**.

Risks: duplicate or conflicting address columns, exposing private company data unnecessarily, and reintroducing legacy UI assumptions.

## 4. Extra customer fields

Origin: `supabase_cliente_campos_extra.sql`.

### Fields identified

- `observacao`;
- `assinante`;
- `valor_assinatura`;
- `endereco`;
- `numero`;
- `complemento`;
- `bairro`.

### Current state

- the current principal does not reference these fields;
- there is no current UI for them;
- older API code used automatic fallbacks for missing columns, but that behavior is not part of the current design.

### Future implementation

- create a versioned migration;
- design the customer-management UI;
- validate subscription and monetary values;
- implement tenant-safe API support;
- add tests for tenant isolation and update behavior;
- fail clearly on a missing migration instead of silently dropping fields through schema fallbacks.

Priority: **LOW/MEDIUM**.

Risks: storing sensitive customer information without a defined UX, ambiguous subscription semantics, and silent data loss if optional-column fallbacks are used.

## Do not reuse directly

Do not restore or copy entire legacy files:

- `app/api/clientes/route.ts` from the stash;
- `app/api/company-profile/route.ts` from the stash;
- `app/api/public-config/route.ts` from the stash;
- automatic fallbacks for missing schema columns;
- the legacy Home/UI;
- manual SQL execution directly in Production.

The current tenant authorization, current public flow, and current redesign must remain the baseline for any future implementation.

## Future implementation rules

Each feature must be:

1. planned before coding;
2. implemented in its own branch;
3. backed by a versioned Supabase migration;
4. tested for tenant isolation and RLS;
5. validated with a successful build;
6. validated in a Preview deployment;
7. promoted to Production only after Preview verification.

## Stash disposition

The legacy stash remains preserved until this documentation and the future-feature backlog have been reviewed. The old application files are not implementation guidance; only the requirements and field names above should be carried forward.
