"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "entrar" | "registo";

export function AuthForm({ initialMode, next }: { initialMode: Mode; next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    const endpoint = mode === "registo" ? "/api/auth/register" : "/api/auth/login";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();

      if (!response.ok) {
        if (json?.error?.details && Array.isArray(json.error.details)) {
          const map: Record<string, string> = {};
          for (const detail of json.error.details) map[detail.field] = detail.problem;
          setFieldErrors(map);
          setError(json.error.message);
        } else {
          setError(json?.error?.message ?? "Não foi possível concluir a operação.");
        }
        return;
      }

      const target =
        next ||
        (mode === "registo"
          ? "/conta"
          : (json?.data?.redirect as string | undefined) ?? "/conta");
      router.push(target);
      router.refresh();
    } catch {
      setError("Falha de rede. Verifique a ligação e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="auth__switch" role="tablist" aria-label="Modo de autenticação">
        <button type="button" aria-pressed={mode === "entrar"} onClick={() => setMode("entrar")}>
          Iniciar sessão
        </button>
        <button type="button" aria-pressed={mode === "registo"} onClick={() => setMode("registo")}>
          Criar conta
        </button>
      </div>

      <h1 style={{ fontSize: "1.75rem" }}>
        {mode === "registo" ? "Criar a tua conta" : "Bem-vindo de volta"}
      </h1>
      <p className="muted" style={{ marginBottom: 22 }}>
        {mode === "registo"
          ? "Leva menos de um minuto. Só precisamos do essencial."
          : "Introduz os dados da tua conta para continuar."}
      </p>

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={submit} noValidate>
        {mode === "registo" ? (
          <>
            <div className="field">
              <label htmlFor="name">Nome completo</label>
              <input id="name" name="name" autoComplete="name" required placeholder="Ana Macuácua" />
              {fieldErrors.name ? <span className="field__error">{fieldErrors.name}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="phone">Telefone</label>
              <input
                id="phone"
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                required
                placeholder="84 123 4567"
              />
              {fieldErrors.phone ? <span className="field__error">{fieldErrors.phone}</span> : null}
            </div>
          </>
        ) : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="nome@exemplo.co.mz"
          />
          {fieldErrors.email ? <span className="field__error">{fieldErrors.email}</span> : null}
        </div>

        <div className="field">
          <label htmlFor="password">Palavra-passe</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "registo" ? "new-password" : "current-password"}
            required
            placeholder="Mínimo 8 caracteres"
          />
          {fieldErrors.password ? <span className="field__error">{fieldErrors.password}</span> : null}
        </div>

        <button className="btn btn--green btn--block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          {mode === "registo" ? "Criar conta" : "Entrar"}
        </button>
      </form>

      <p className="hint" style={{ marginTop: 16 }}>
        Ao continuar aceitas os termos de utilização e a política de privacidade da Express
        Delivery. As credenciais são guardadas com hash bcrypt; nunca guardamos dados de cartões.
      </p>
    </div>
  );
}
