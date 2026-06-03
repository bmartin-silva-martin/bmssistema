-- Adiciona preco de custo na tabela de produtos
-- Execute no SQL Editor do Supabase

alter table produtos
add column if not exists preco_custo numeric(10,2);
