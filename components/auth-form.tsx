"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "setup" | "login" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) return setError(payload.error || "Не удалось войти");
    router.push("/");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">F</div>
        <span className="eyebrow">Filament ERP</span>
        <h1>{mode === "setup" ? "Первый администратор" : "Вход в систему"}</h1>
        <p>{mode === "setup" ? "Создайте единственную учётную запись для локального MVP." : "Используйте данные администратора."}</p>
        <label><span>Email</span><input name="email" type="email" required autoComplete="email" /></label>
        <label><span>Пароль</span><input name="password" type="password" minLength={8} required autoComplete={mode === "setup" ? "new-password" : "current-password"} /></label>
        {error && <div className="notice error">{error}</div>}
        <button className="button primary" disabled={loading}>{loading ? "Подождите…" : mode === "setup" ? "Создать администратора" : "Войти"}</button>
      </form>
    </main>
  );
}
