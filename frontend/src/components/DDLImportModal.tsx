"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { importDDL } from "@/lib/api";
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

export function DDLImportModal({ onSuccess, onClose }: DDLImportModalProps) {
  const [dbType, setDbType] = useState<SqlType>("hive");
  const [databaseName, setDatabaseName] = useState("");
  const [ddl, setDdl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleImport = async () => {
    if (!ddl.trim()) {
      setError("请输入 DDL 语句");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const tables = await importDDL(ddl, dbType, databaseName || undefined);
      onSuccess(tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setLoading(false);
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#8892a4] mb-1.5">数据库类型</label>
              <div className="flex gap-2">
                {(["hive", "postgresql", "oracle"] as SqlType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setDbType(t);
                      if (t === "hive") {
                        setDdl(HIVE_EXAMPLE);
                      } else if (t === "postgresql") {
                        setDdl(PG_EXAMPLE);
                      } else {
                        setDdl(ORACLE_EXAMPLE);
                      }
                    }}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-sm border transition-all",
                      dbType === t
                        ? t === "hive"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : t === "postgresql"
                          ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                          : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : "bg-[#12151f] text-[#8892a4] border-[#2a2d3d] hover:text-[#e2e8f0]"
                    )}
                  >
                    {t === "hive" ? "Hive" : t === "postgresql" ? "PostgreSQL" : "Oracle"}
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
