"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { createMetadata } from "@/lib/api";
import type { ColumnInfo, SqlType, TableMetadata } from "@/types";

interface MetadataFormProps {
  onSuccess: (table: TableMetadata) => void;
  onClose: () => void;
}

const emptyColumn = (): ColumnInfo => ({
  name: "",
  type: "STRING",
  comment: "",
  nullable: true,
  is_partition_key: false,
});

export function MetadataForm({ onSuccess, onClose }: MetadataFormProps) {
  const [dbType, setDbType] = useState<SqlType>("hive");
  const [databaseName, setDatabaseName] = useState("");
  const [schemaName, setSchemaName] = useState("");
  const [tableName, setTableName] = useState("");
  const [tableComment, setTableComment] = useState("");
  const [tags, setTags] = useState("");
  const [columns, setColumns] = useState<ColumnInfo[]>([emptyColumn()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const addColumn = () => setColumns((prev) => [...prev, emptyColumn()]);
  const removeColumn = (idx: number) =>
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  const updateColumn = (idx: number, field: keyof ColumnInfo, value: unknown) =>
    setColumns((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!tableName.trim()) {
      setError("表名不能为空");
      return;
    }
    if (columns.some((c) => !c.name.trim())) {
      setError("所有字段名不能为空");
      return;
    }
    setLoading(true);
    try {
      const result = await createMetadata({
        db_type: dbType,
        database_name: databaseName || null,
        schema_name: schemaName || null,
        table_name: tableName,
        table_comment: tableComment || null,
        columns,
        sample_data: null,
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
      });
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-app-surface border border-app-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-app-surface border-b border-app-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-app-text">新增表元数据</h2>
          <button onClick={onClose} className="text-app-muted hover:text-app-text">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* DB Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-app-muted mb-1.5">数据库类型</label>
              <div className="flex flex-wrap gap-2">
                {(["hive", "postgresql", "mysql", "oracle"] as SqlType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDbType(t)}
                    className={cn(
                      "flex-1 min-w-[4.5rem] py-2 rounded-lg text-sm font-medium border transition-all",
                      dbType === t
                        ? t === "hive"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : t === "postgresql"
                          ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                          : t === "mysql"
                          ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                          : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : "bg-app-input text-app-muted border-app-border hover:text-app-text"
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
              <label className="block text-xs text-app-muted mb-1.5">数据库名</label>
              <input
                value={databaseName}
                onChange={(e) => setDatabaseName(e.target.value)}
                placeholder="如: dw"
                className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-app-muted mb-1.5">
                表名 <span className="text-red-400">*</span>
              </label>
              <input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="如: ods_orders"
                required
                className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
              />
            </div>
            <div>
              <label className="block text-xs text-app-muted mb-1.5">Schema</label>
              <input
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value)}
                placeholder="如: public"
                className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-app-muted mb-1.5">表说明</label>
            <input
              value={tableComment}
              onChange={(e) => setTableComment(e.target.value)}
              placeholder="描述这张表的用途..."
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
            />
          </div>

          <div>
            <label className="block text-xs text-app-muted mb-1.5">
              标签 <span className="text-app-subtle">（逗号分隔）</span>
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="ods, orders, transaction"
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
            />
          </div>

          {/* Columns */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-app-muted">
                字段定义 <span className="text-red-400">*</span>
              </label>
              <button
                type="button"
                onClick={addColumn}
                className="flex items-center gap-1 text-xs text-app-accent hover:text-sky-500 dark:hover:text-sky-300"
              >
                <Plus size={12} />
                添加字段
              </button>
            </div>

            <div className="space-y-2">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 text-xs text-app-subtle px-1">
                <span className="col-span-3">字段名</span>
                <span className="col-span-2">类型</span>
                <span className="col-span-4">注释</span>
                <span className="col-span-1 text-center">可空</span>
                <span className="col-span-1 text-center">分区</span>
                <span className="col-span-1" />
              </div>

              {columns.map((col, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    value={col.name}
                    onChange={(e) => updateColumn(idx, "name", e.target.value)}
                    placeholder="column_name"
                    className="col-span-3 bg-app-input border border-app-border rounded-lg px-2 py-1.5 text-xs text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
                  />
                  <input
                    value={col.type}
                    onChange={(e) => updateColumn(idx, "type", e.target.value)}
                    placeholder="STRING"
                    className="col-span-2 bg-app-input border border-app-border rounded-lg px-2 py-1.5 text-xs text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
                  />
                  <input
                    value={col.comment}
                    onChange={(e) => updateColumn(idx, "comment", e.target.value)}
                    placeholder="字段说明"
                    className="col-span-4 bg-app-input border border-app-border rounded-lg px-2 py-1.5 text-xs text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
                  />
                  <div className="col-span-1 flex justify-center">
                    <input
                      type="checkbox"
                      checked={col.nullable}
                      onChange={(e) => updateColumn(idx, "nullable", e.target.checked)}
                      className="accent-app"
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <input
                      type="checkbox"
                      checked={col.is_partition_key}
                      onChange={(e) => updateColumn(idx, "is_partition_key", e.target.checked)}
                      className="accent-amber-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeColumn(idx)}
                    disabled={columns.length === 1}
                    className="col-span-1 flex justify-center text-app-subtle hover:text-red-400 disabled:opacity-20"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-app-border text-sm text-app-muted hover:text-app-text transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-app-accent hover:bg-app-accent-hover disabled:bg-app-border text-white text-sm font-medium transition-colors"
            >
              {loading ? "提交中..." : "保存并生成向量"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
