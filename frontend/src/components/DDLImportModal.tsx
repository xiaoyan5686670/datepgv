"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { importDDL, importDDLFile } from "@/lib/api";
import type { SqlType, TableMetadata } from "@/types";

interface DDLImportModalProps {
  onSuccess: (tables: TableMetadata[]) => void;
  onClose: () => void;
}

const HIVE_EXAMPLE = `CREATE TABLE dw.fact_sales (
  order_id   STRING    COMMENT '订单ID',
  product_id STRING    COMMENT '商品ID',
  user_id    STRING    COMMENT '用户ID',
  amount     DECIMAL   COMMENT '销售金额',
  sale_date  DATE      COMMENT '销售日期',
  dt         STRING    COMMENT '分区日期'
)
COMMENT '销售事实表'
PARTITIONED BY (dt STRING);`;

const PG_EXAMPLE = `CREATE TABLE public.dim_product (
  product_id   VARCHAR(64)  PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  category     VARCHAR(100),
  price        NUMERIC(10,2),
  created_at   TIMESTAMP DEFAULT NOW()
);
COMMENT ON TABLE public.dim_product IS '商品维度表';`;

const ORACLE_EXAMPLE = `CREATE TABLE DW.FACT_SALES (
  ORDER_ID    VARCHAR2(64)   NOT NULL,
  PRODUCT_ID  VARCHAR2(64)   NOT NULL,
  USER_ID     VARCHAR2(64)   NOT NULL,
  AMOUNT      NUMBER(12,2)   NOT NULL,
  SALE_DATE   DATE           NOT NULL,
  CHANNEL     VARCHAR2(32),
  REGION      VARCHAR2(64)
);
COMMENT ON TABLE DW.FACT_SALES IS '销售事实表';
COMMENT ON COLUMN DW.FACT_SALES.AMOUNT IS '销售金额';`;

const MYSQL_EXAMPLE = `CREATE TABLE sales_summary (
  summary_date DATE NOT NULL,
  department VARCHAR(100) NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  order_count INT NOT NULL,
  PRIMARY KEY (summary_date, department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='销售汇总';`;

export function DDLImportModal({ onSuccess, onClose }: DDLImportModalProps) {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [dbType, setDbType] = useState<SqlType>("hive");
  const [databaseName, setDatabaseName] = useState("");
  const [ddl, setDdl] = useState("");
  const [ddlFile, setDdlFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const mapImportError = (raw: string): string => {
    if (raw.includes("编码") || raw.toLowerCase().includes("encoding")) {
      return `文件编码问题: ${raw}`;
    }
    if (
      raw.includes("仅支持") ||
      raw.includes("文件为空") ||
      raw.includes("请上传")
    ) {
      return `文件格式问题: ${raw}`;
    }
    if (raw.includes("CREATE TABLE") || raw.includes("方言")) {
      return `DDL 语法问题: ${raw}`;
    }
    return `导入失败: ${raw}`;
  };

  const handleImport = async () => {
    if (mode === "text") {
      if (!ddl.trim()) {
        setError("请输入 DDL 语句");
        return;
      }
    } else if (!ddlFile) {
      setError("请先选择 DDL 文件");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const tables =
        mode === "text"
          ? await importDDL(ddl, dbType, databaseName || undefined)
          : await importDDLFile(ddlFile!, dbType, databaseName || undefined);
      onSuccess(tables);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "导入失败";
      setError(mapImportError(raw));
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file: File | null) => {
    setDdlFile(file);
    setPreview("");
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).slice(0, 20);
      setPreview(lines.join("\n"));
    } catch {
      setPreview("（预览失败：当前浏览器无法读取该文件文本）");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1d27] border border-[#2a2d3d] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1a1d27] border-b border-[#2a2d3d] px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#e2e8f0]">DDL 解析导入</h2>
          <button onClick={onClose} className="text-[#8892a4] hover:text-[#e2e8f0]">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-[#8892a4] mb-1.5">导入方式</label>
            <div className="inline-flex gap-2 bg-[#12151f] border border-[#2a2d3d] rounded-lg p-1">
              <button
                type="button"
                onClick={() => setMode("text")}
                className={cn(
                  "px-3 py-1.5 rounded text-xs transition-colors",
                  mode === "text"
                    ? "bg-[#0ea5e9]/20 text-[#7dd3fc]"
                    : "text-[#8892a4] hover:text-[#e2e8f0]"
                )}
              >
                文本粘贴
              </button>
              <button
                type="button"
                onClick={() => setMode("file")}
                className={cn(
                  "px-3 py-1.5 rounded text-xs transition-colors",
                  mode === "file"
                    ? "bg-[#0ea5e9]/20 text-[#7dd3fc]"
                    : "text-[#8892a4] hover:text-[#e2e8f0]"
                )}
              >
                文件上传
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#8892a4] mb-1.5">数据库类型</label>
              <div className="flex flex-wrap gap-2">
                {(["hive", "postgresql", "mysql", "oracle"] as SqlType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setDbType(t);
                      if (t === "hive") {
                        setDdl(HIVE_EXAMPLE);
                      } else if (t === "postgresql") {
                        setDdl(PG_EXAMPLE);
                      } else if (t === "mysql") {
                        setDdl(MYSQL_EXAMPLE);
                      } else {
                        setDdl(ORACLE_EXAMPLE);
                      }
                    }}
                    className={cn(
                      "flex-1 min-w-[5rem] py-1.5 rounded-lg text-sm border transition-all",
                      dbType === t
                        ? t === "hive"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : t === "postgresql"
                          ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                          : t === "mysql"
                          ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                          : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : "bg-[#12151f] text-[#8892a4] border-[#2a2d3d] hover:text-[#e2e8f0]"
                    )}
                  >
                    {t === "hive"
                      ? "Hive"
                      : t === "postgresql"
                      ? "PostgreSQL"
                      : t === "mysql"
                      ? "MySQL"
                      : "Oracle"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#8892a4] mb-1.5">数据库名（可选）</label>
              <input
                value={databaseName}
                onChange={(e) => setDatabaseName(e.target.value)}
                placeholder="如: dw"
                className="w-full bg-[#12151f] border border-[#2a2d3d] rounded-lg px-3 py-1.5 text-sm text-[#e2e8f0] placeholder-[#4a5568] outline-none focus:border-[#0ea5e9]/50"
              />
            </div>
          </div>

          {mode === "text" ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-[#8892a4]">
                  DDL 语句（支持多张表）
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDdl(
                      dbType === "hive"
                        ? HIVE_EXAMPLE
                        : dbType === "postgresql"
                        ? PG_EXAMPLE
                        : dbType === "mysql"
                        ? MYSQL_EXAMPLE
                        : ORACLE_EXAMPLE
                    )
                  }
                  className="text-xs text-[#0ea5e9] hover:text-[#38bdf8]"
                >
                  填入示例
                </button>
              </div>
              <textarea
                value={ddl}
                onChange={(e) => setDdl(e.target.value)}
                placeholder="粘贴 CREATE TABLE 语句..."
                rows={12}
                className="w-full bg-[#0f1117] border border-[#2a2d3d] rounded-xl px-4 py-3 text-sm text-[#e2e8f0] placeholder-[#4a5568] outline-none focus:border-[#0ea5e9]/50 font-mono resize-none"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#8892a4] block mb-1.5">
                  选择 DDL 文件（.sql / .ddl / .txt）
                </label>
                <input
                  type="file"
                  accept=".sql,.ddl,.txt,text/plain"
                  onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-[#8892a4] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-[#2a2d3d] file:bg-[#12151f] file:text-[#e2e8f0] hover:file:border-[#0ea5e9]/50"
                />
                {ddlFile && (
                  <p className="mt-2 text-xs text-[#4a5568]">
                    已选择: {ddlFile.name} ({(ddlFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-[#8892a4] block mb-1.5">
                  导入前预览（前 20 行）
                </label>
                <textarea
                  value={preview}
                  readOnly
                  rows={10}
                  placeholder="选择文件后显示预览"
                  className="w-full bg-[#0f1117] border border-[#2a2d3d] rounded-xl px-4 py-3 text-sm text-[#a8b2c7] placeholder-[#4a5568] outline-none font-mono resize-none"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[#2a2d3d] text-sm text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-[#0ea5e9] hover:bg-[#0284c7] disabled:bg-[#2a2d3d] text-white text-sm font-medium transition-colors"
            >
              {loading ? "解析中..." : "解析并导入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
