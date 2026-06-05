-- Adiciona coluna features na tabela empresas
-- Execute este SQL no Supabase SQL Editor

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '{}';

-- Exemplos de uso:

-- Personalizar cores de uma barbearia (substitua o ID)
-- UPDATE empresas SET features = jsonb_build_object(
--   'cor_primaria', '#ff6b00',
--   'cor_secundaria', '#1a1a2e'
-- ) WHERE id = SEU_ID_AQUI;

-- Adicionar logo (URL publica da imagem)
-- UPDATE empresas SET features = features || jsonb_build_object(
--   'logo_url', 'https://sua-url-de-imagem.com/logo.png'
-- ) WHERE id = SEU_ID_AQUI;

-- Ativar modulo exclusivo
-- UPDATE empresas SET features = features || jsonb_build_object(
--   'modulo_comissao', true
-- ) WHERE id = SEU_ID_AQUI;

-- Ver configuracoes atuais de todas as barbearias
-- SELECT id, nome, features FROM empresas;
