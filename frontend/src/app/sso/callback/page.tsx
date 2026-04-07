"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { setStoredAccessToken } from "@/lib/api";

function SsoCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const token = params.get("access_token");
    const nextRaw = searchParams.get("next");
    const next =
      nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//")
        ? nextRaw
        : "/";

    if (!token) {
      setError("缺少登录凭证，请从办公系统入口重新打开链接。");
      return;
    }

    setStoredAccessToken(token);
    router.replace(next);
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text flex flex-col items-center justify-center px-4">
        <p className="text-sm text-red-400 mb-4 text-center max-w-md">{error}</p>
        <Link
          href="/login"
          className="text-sm text-app-accent hover:underline"
        >
          前往手动登录
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center text-app-muted">
      <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
    </div>
  );
}

export default function SsoCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-app-bg flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
        </div>
      }
    >
      <SsoCallbackInner />
    </Suspense>
  );
}
