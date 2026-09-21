import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export type AuthorizedRequest = {
  empresaId: number;
  supabase: SupabaseClient;
  user: User;
};

type AuthorizationFailure = {
  response: NextResponse;
};

function failure(error: string, status: number): AuthorizationFailure {
  return { response: NextResponse.json({ error }, { status }) };
}

export async function authorizeRequest(
  request: Request,
  requestedEmpresaId?: unknown,
): Promise<AuthorizedRequest | AuthorizationFailure> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return failure("Supabase nao configurado no servidor.", 500);
  }

  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1].trim();

  if (!token) {
    return failure("Sessao nao informada.", 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);

  if (userError || !userData.user) {
    return failure("Sessao invalida. Entre novamente no painel.", 401);
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return failure("Supabase Service Role nao configurada na Vercel.", 500);
  }

  const requestedValue = requestedEmpresaId === undefined || requestedEmpresaId === null || requestedEmpresaId === ""
    ? undefined
    : Number(requestedEmpresaId);

  if (requestedValue !== undefined && (!Number.isInteger(requestedValue) || requestedValue <= 0)) {
    return failure("Empresa nao autorizada.", 403);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let query = supabase.from("empresas").select("id").eq("owner_user_id", userData.user.id);

  if (requestedValue !== undefined) {
    query = query.eq("id", requestedValue);
  }

  const { data: empresas, error: empresaError } = await query.order("id").limit(1);

  if (empresaError) {
    return failure(empresaError.message, 500);
  }

  const empresa = empresas?.[0];
  if (!empresa) {
    return failure("Usuario sem empresa autorizada.", 403);
  }

  return { empresaId: empresa.id, supabase, user: userData.user };
}
