"use client";

import { usePathname } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { MobileBottomNav } from "@/components/navigation/MobileBottomNav";

function getActiveKey(pathname: string): "home" | "users" | "admin" | "settings" {
  if (pathname.startsWith("/users")) return "users";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
}

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const activeKey = getActiveKey(pathname);

  return (
    <AuthGuard>
      <div className="min-h-screen pb-16 sm:pb-0">
        {children}
        <MobileBottomNav activeKey={activeKey} />
      </div>
    </AuthGuard>
  );
}
