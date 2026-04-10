"use client";

import { Database, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const REMEMBER_KEY = "datepgv_remember_cred";

function loadSavedCredentials(): { username: string; password: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const decoded = JSON.parse(atob(raw));
    if (decoded?.username && decoded?.password) return decoded;
  } catch { /* corrupted */ }
  return null;
}

function saveCredentials(username: string, password: string) {
  localStorage.setItem(REMEMBER_KEY, btoa(JSON.stringify({ username, password })));
}

function clearSavedCredentials() {
  localStorage.removeItem(REMEMBER_KEY);
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") || "/";
  const { user, loading, login } = useAuth();

  const saved = loadSavedCredentials();
  const [username, setUsername] = useState(saved?.username ?? "");
  const [password, setPassword] = useState(saved?.password ?? "");
  const [remember, setRemember] = useState(!!saved);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace(returnUrl.startsWith("/") ? returnUrl : "/");
    }
  }, [user, loading, router, returnUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      if (remember) {
        saveCredentials(username.trim(), password);
      } else {
        clearSavedCredentials();
      }
      router.replace(returnUrl.startsWith("/") ? returnUrl : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || user) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-app-border bg-app-input">
        <Link href="/docs" className="flex items-center gap-2 text-app-muted hover:text-app-text text-sm">
          <Database size={18} className="text-app-accent" />
          文档
        </Link>
        <ThemeToggle className="p-2 rounded-lg border border-app-border text-app-muted hover:text-app-text" />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-8 shadow-xl">
          <h1 className="text-xl font-semibold text-center mb-1">登录</h1>
          <p className="text-xs text-app-muted text-center mb-6">
            使用分配的内网账号登录；管理员可维护元数据与模型配置。
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs text-app-muted mb-1.5">
                用户名
              </label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm focus:border-app-accent/50 focus:outline-none"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs text-app-muted mb-1.5">
                密码
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm focus:border-app-accent/50 focus:outline-none"
                required
              />
            </div>

            <label className="flex items-center gap-2 select-none cursor-pointer group">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-app-border text-app-accent focus:ring-app-accent/30 accent-app-accent cursor-pointer"
              />
              <span className="text-xs text-app-muted group-hover:text-app-text transition-colors">
                记住密码
              </span>
            </label>

            {error ? (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className={cn(
                "w-full rounded-lg py-2.5 text-sm font-medium text-white transition-colors",
                "bg-app-accent hover:bg-app-accent-hover disabled:opacity-50"
              )}
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中…
                </span>
              ) : (
                "登录"
              )}
            </button>
          </form>

          <p className="text-[11px] text-app-subtle mt-6 text-center leading-relaxed">
            首次部署请执行{" "}
            <code className="text-app-accent/90">init-db/08-auth_users_roles.sql</code>
            ，默认 <code className="text-app-accent/90">admin</code> /{" "}
            <code className="text-app-accent/90">changeme</code>（务必修改密码）。
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-app-bg flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
