import type { Metadata } from "next";
import { AuthGuard } from "@/components/AuthGuard";
import { SchemaGraphPageClient } from "./SchemaGraphPageClient";

export const metadata: Metadata = {
  title: "表关系图 | NL-to-SQL",
  description: "可视化表与表之间的关联关系",
};

export default function SchemaGraphPage() {
  return (
    <AuthGuard>
      <SchemaGraphPageClient />
    </AuthGuard>
  );
}
