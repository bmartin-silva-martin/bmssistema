-- Tenant-safe RLS for authenticated administration.
-- Public booking flows use server-side APIs and therefore do not need public/anon policies.

CREATE POLICY "empresas_authenticated_select"
  ON public.empresas
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY "clientes_authenticated_select"
  ON public.clientes
  FOR SELECT
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "clientes_authenticated_insert"
  ON public.clientes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "servicos_authenticated_select"
  ON public.servicos
  FOR SELECT
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "servicos_authenticated_insert"
  ON public.servicos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "servicos_authenticated_update"
  ON public.servicos
  FOR UPDATE
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "agendamentos_authenticated_select"
  ON public.agendamentos
  FOR SELECT
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "agendamentos_authenticated_insert"
  ON public.agendamentos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "agendamentos_authenticated_update"
  ON public.agendamentos
  FOR UPDATE
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "produtos_authenticated_select"
  ON public.produtos
  FOR SELECT
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "produtos_authenticated_insert"
  ON public.produtos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "produtos_authenticated_update"
  ON public.produtos
  FOR UPDATE
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "vendas_authenticated_select"
  ON public.vendas
  FOR SELECT
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "vendas_authenticated_insert"
  ON public.vendas
  FOR INSERT
  TO authenticated
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "venda_itens_authenticated_select"
  ON public.venda_itens
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendas AS venda
      JOIN public.empresas AS empresa ON empresa.id = venda.empresa_id
      WHERE venda.id = venda_itens.venda_id
        AND empresa.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "venda_itens_authenticated_insert"
  ON public.venda_itens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vendas AS venda
      JOIN public.empresas AS empresa ON empresa.id = venda.empresa_id
      JOIN public.produtos AS produto ON produto.id = venda_itens.produto_id
      WHERE venda.id = venda_itens.venda_id
        AND produto.empresa_id = venda.empresa_id
        AND empresa.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "profissionais_authenticated_select"
  ON public.profissionais
  FOR SELECT
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "profissionais_authenticated_insert"
  ON public.profissionais
  FOR INSERT
  TO authenticated
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "profissionais_authenticated_update"
  ON public.profissionais
  FOR UPDATE
  TO authenticated
  USING (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    empresa_id IN (
      SELECT id
      FROM public.empresas
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "profissional_servicos_authenticated_select"
  ON public.profissional_servicos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profissionais AS profissional
      JOIN public.servicos AS servico ON servico.empresa_id = profissional.empresa_id
      JOIN public.empresas AS empresa ON empresa.id = profissional.empresa_id
      WHERE profissional.id = profissional_servicos.profissional_id
        AND servico.id = profissional_servicos.servico_id
        AND empresa.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "profissional_servicos_authenticated_insert"
  ON public.profissional_servicos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profissionais AS profissional
      JOIN public.servicos AS servico ON servico.empresa_id = profissional.empresa_id
      JOIN public.empresas AS empresa ON empresa.id = profissional.empresa_id
      WHERE profissional.id = profissional_servicos.profissional_id
        AND servico.id = profissional_servicos.servico_id
        AND empresa.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "profissional_servicos_authenticated_delete"
  ON public.profissional_servicos
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profissionais AS profissional
      JOIN public.servicos AS servico ON servico.empresa_id = profissional.empresa_id
      JOIN public.empresas AS empresa ON empresa.id = profissional.empresa_id
      WHERE profissional.id = profissional_servicos.profissional_id
        AND servico.id = profissional_servicos.servico_id
        AND empresa.owner_user_id = auth.uid()
    )
  );

-- Remove broad public/anon access only after the authenticated replacements exist.
DROP POLICY IF EXISTS "Allow public insert appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "Allow public select appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "Allow public update appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "permitir atualizar agendamentos anon" ON public.agendamentos;
DROP POLICY IF EXISTS "permitir inserir agendamentos" ON public.agendamentos;
DROP POLICY IF EXISTS "permitir leitura agendamentos" ON public.agendamentos;

DROP POLICY IF EXISTS "Allow public insert clients" ON public.clientes;
DROP POLICY IF EXISTS "Allow public select clients" ON public.clientes;
DROP POLICY IF EXISTS "Dono pode excluir clientes da sua empresa" ON public.clientes;
DROP POLICY IF EXISTS "permitir inserir clientes anon" ON public.clientes;
DROP POLICY IF EXISTS "permitir leitura clientes anon" ON public.clientes;

DROP POLICY IF EXISTS "Allow public select empresas" ON public.empresas;
DROP POLICY IF EXISTS "permitir leitura empresas" ON public.empresas;

DROP POLICY IF EXISTS "Allow public insert products" ON public.produtos;
DROP POLICY IF EXISTS "Allow public select products" ON public.produtos;
DROP POLICY IF EXISTS "Allow public update products" ON public.produtos;

DROP POLICY IF EXISTS "Allow public insert services" ON public.servicos;
DROP POLICY IF EXISTS "Allow public select services" ON public.servicos;
DROP POLICY IF EXISTS "Allow public update services" ON public.servicos;
DROP POLICY IF EXISTS "permitir leitura servicos" ON public.servicos;

DROP POLICY IF EXISTS "Allow public insert sales" ON public.vendas;
DROP POLICY IF EXISTS "Allow public select sales" ON public.vendas;
DROP POLICY IF EXISTS "Allow public update sales" ON public.vendas;

DROP POLICY IF EXISTS "Allow public insert venda_itens" ON public.venda_itens;
DROP POLICY IF EXISTS "Allow public select venda_itens" ON public.venda_itens;

DROP POLICY IF EXISTS "Allow public insert push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Qualquer um pode inserir subscricao" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Service role pode ler subscricoes" ON public.push_subscriptions;

DROP POLICY IF EXISTS "Donos gerenciam profissionais da propria empresa" ON public.profissionais;
