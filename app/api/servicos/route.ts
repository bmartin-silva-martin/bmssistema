import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function DELETE(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase Service Role nao configurada." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  const empresaId = Number(searchParams.get("empresaId")) || 1;

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Servico invalido." }, { status: 400 });
  }

  // Bloquear se houver agendamentos vinculados
  const { count: agCount } = await supabase
    .from("agendamentos")
    .select("id", { count: "exact", head: true })
    .eq("servico_id", id)
    .eq("empresa_id", empresaId);

  if (agCount && agCount > 0) {
    return NextResponse.json(
      { error: `Este servico possui ${agCount} agendamento(s) registrado(s) e nao pode ser excluido. Desative-o ou renomeie-o.` },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("servicos")
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
