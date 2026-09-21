import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  const authorization = await authorizeRequest(request, searchParams.get("empresaId"));
  if ("response" in authorization) return authorization.response;

  const { empresaId, supabase } = authorization;

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Produto invalido." }, { status: 400 });
  }

  // Bloquear se houver vendas vinculadas
  const { count: vendaCount } = await supabase
    .from("venda_itens")
    .select("id", { count: "exact", head: true })
    .eq("produto_id", id);

  if (vendaCount && vendaCount > 0) {
    return NextResponse.json(
      { error: `Este produto possui ${vendaCount} venda(s) registrada(s) e nao pode ser excluido. Ajuste o estoque para zero se quiser desativa-lo.` },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("produtos")
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
