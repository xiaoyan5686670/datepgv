import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "NL-to-SQL | 自然语言转 SQL",
  description: "RAG-powered natural language to Hive/PostgreSQL generator",
};

const themeInitScript = `(function(){try{var k='datepgv_theme';var t=localStorage.getItem(k);var dark=t!=='light';document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* 密码管理器 / 自动填充等扩展会在表单上注入 field_signature 等属性，导致水合告警 */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
