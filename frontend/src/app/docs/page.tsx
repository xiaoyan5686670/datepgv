import fs from "fs/promises";
import path from "path";
import { DocsClient } from "@/components/DocsClient";

async function readMarkdown(relativePath: string): Promise<string> {
  // process.cwd() 对于前端应用通常是 frontend 目录，
  // 仓库根目录在上一级，因此需要先 .. 再拼接 docs 路径。
  const fullPath = path.join(process.cwd(), "..", relativePath);
  try {
    const buf = await fs.readFile(fullPath, "utf-8");
    return buf.toString();
  } catch {
    return `无法读取文档：${relativePath}`;
  }
}

export default async function DocsPage() {
  const [installSource, guideSource] = await Promise.all([
    readMarkdown("docs/INSTALL.md"),
    readMarkdown("docs/USER_GUIDE.md"),
  ]);

  return <DocsClient installSource={installSource} guideSource={guideSource} />;
}

