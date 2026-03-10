import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NL-to-SQL | 自然语言转 SQL",
  description: "RAG-powered natural language to Hive/PostgreSQL generator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
