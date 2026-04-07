"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

type AuthGuardProps = {
  children: React.ReactNode;
  /** 需要 admin 角色（模型配置、元数据维护等） */
  requireAdmin?: boolean;
};

export function AuthGuard({ children, requireAdmin }: AuthGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const q = new URLSearchParams({ returnUrl: pathname });
      router.replace(`/login?${q.toString()}`);
      return;
    }
    if (requireAdmin && !user.roles.includes("admin")) {
      router.replace("/");
    }
  }, [user, loading, requireAdmin, router, pathname]);

  if (loading || !user || (requireAdmin && !user.roles.includes("admin"))) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center text-app-muted">
        <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
      </div>
    );
  }

  return <>{children}</>;
}
