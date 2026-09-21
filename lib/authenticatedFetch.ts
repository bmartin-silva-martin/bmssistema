import { supabase } from "@/lib/supabase";

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return new Response(JSON.stringify({ error: "Sessao nao informada." }), {
      headers: { "Content-Type": "application/json" },
      status: 401,
    });
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}
