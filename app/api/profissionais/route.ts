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
    return NextResponse.json({ error: "Profissional invalido." }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("profissionais")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (count === 0) {
    return NextResponse.json({ error: "Profissional nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
