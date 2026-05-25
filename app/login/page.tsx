"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type AuthMode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [modo, setModo] = useState<AuthMode>("login");
  const [carregando, setCarregando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  async function autenticar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email || !senha) {
      setMensagem("Informe email e senha para continuar.");
      return;
    }

    if (!isSupabaseConfigured) {
      setMensagem("Supabase nao configurado. Confira NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setCarregando(true);
    setMensagem(modo === "login" ? "Entrando..." : "Criando conta...");

    const { error } =
      modo === "login"
        ? await supabase.auth.signInWithPassword({ email, password: senha })
        : await supabase.auth.signUp({ email, password: senha });

    setCarregando(false);

    if (error) {
      setMensagem(`Erro: ${error.message}`);
      return;
    }

    if (modo === "signup") {
      setMensagem("Conta criada. Verifique seu email, se a confirmacao estiver ativa.");
      setModo("login");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  async function recuperarSenha() {
    if (!email) {
      setMensagem("Informe seu email para receber o link de recuperacao.");
      return;
    }

    if (!isSupabaseConfigured) {
      setMensagem("Supabase nao configurado. Confira NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setCarregando(true);
    setMensagem("Enviando email de recuperacao...");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });

    setCarregando(false);

    if (error) {
      setMensagem(`Erro: ${error.message}`);
      return;
    }

    setMensagem("Se esse email estiver cadastrado, enviaremos um link para redefinir a senha.");
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">BMS Sistema</p>
          <h1>Acesse sua central</h1>
          <p className="muted">Controle empresas, servicos e agendamentos em um painel simples.</p>
        </div>

        <form className="form-stack" onSubmit={autenticar}>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@empresa.com"
              type="email"
              value={email}
            />
          </label>

          <label>
            Senha
            <span className="password-field">
              <input
                autoComplete={modo === "login" ? "current-password" : "new-password"}
                minLength={6}
                onChange={(event) => setSenha(event.target.value)}
                placeholder="Minimo de 6 caracteres"
                type={mostrarSenha ? "text" : "password"}
                value={senha}
              />
              <button
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                className="password-toggle"
                onClick={() => setMostrarSenha((atual) => !atual)}
                type="button"
              >
                {mostrarSenha ? "Ocultar" : "Ver"}
              </button>
            </span>
          </label>

          <button className="button button-primary" disabled={carregando || !isSupabaseConfigured} type="submit">
            {carregando ? "Aguarde..." : modo === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        {modo === "login" && (
          <button
            className="text-button"
            disabled={carregando || !isSupabaseConfigured}
            onClick={recuperarSenha}
            type="button"
          >
            Esqueci minha senha
          </button>
        )}

        <button
          className="button button-ghost"
          disabled={carregando}
          onClick={() => {
            setMensagem("");
            setModo((atual) => (atual === "login" ? "signup" : "login"));
          }}
          type="button"
        >
          {modo === "login" ? "Criar uma nova conta" : "Ja tenho conta"}
        </button>

        {!isSupabaseConfigured && (
          <p className="notice notice-error">
            Supabase nao configurado. Reinicie o servidor apos ajustar o arquivo .env.local.
          </p>
        )}

        {mensagem && <p className="status-message">{mensagem}</p>}
      </section>
    </main>
  );
}
