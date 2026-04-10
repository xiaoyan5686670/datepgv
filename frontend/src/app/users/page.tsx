"use client";

import {
  ArrowLeft,
  Download,
  Edit2,
  GitBranch,
  Loader2,
  Search,
  Settings,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { UserChip } from "@/components/UserChip";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  createUser,
  fetchOrgGraph,
  deleteUser,
  fetchUsers,
  importUsers,
  importUsersCsv,
  syncUsersFromOrgCsv,
  updateUser,
} from "@/lib/api";
import type {
  EmployeeOrgLevel,
  OrgGraphNode,
  User,
  UserCreate,
  UserUpdate,
  UserImportResponse,
  SyncOrgCsvResponse,
} from "@/types";

// 层级从高到低：大区总 > 省总 > 省区经理 > 区域总 > 区域经理 > 基层
const EMPLOYEE_LEVEL_VALUES: readonly EmployeeOrgLevel[] = [
  "admin",
  "region_executive",
  "province_executive",
  "province_manager",
  "area_executive",
  "area_manager",
  "staff",
] as const;

const EMPLOYEE_LEVELS: { value: EmployeeOrgLevel; label: string }[] = [
  { value: "admin", label: "管理员" },
  { value: "region_executive", label: "大区总" },
  { value: "province_executive", label: "省总" },
  { value: "province_manager", label: "省区经理" },
  { value: "area_executive", label: "区域总" },
  { value: "area_manager", label: "区域经理" },
  { value: "staff", label: "业务经理 / 基层" },
];

const LEVEL_COLORS: Record<string, string> = {
  admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  region_executive: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  province_executive: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  area_executive: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  province_manager: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  area_manager: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  staff: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const LEVEL_LABELS: Record<string, string> = {
  admin: "管理员",
  region_executive: "大区总",
  province_executive: "省总",
  area_executive: "区域总",
  province_manager: "省区经理",
  area_manager: "区域经理",
  staff: "业务经理",
};

// ── Create / Edit Modal ──────────────────────────────────────────────────────

interface UserFormModalProps {
  editUser?: User | null;
  onClose: () => void;
  onSaved: () => void;
}

function normalizeEmployeeLevel(v: string | undefined): EmployeeOrgLevel {
  if (v && (EMPLOYEE_LEVEL_VALUES as readonly string[]).includes(v)) {
    return v as EmployeeOrgLevel;
  }
  return "staff";
}

function UserFormModal({ editUser, onClose, onSaved }: UserFormModalProps) {
  const [username, setUsername] = useState(editUser?.username ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(editUser?.full_name ?? "");
  const [province, setProvince] = useState(editUser?.province ?? "");
  const [orgRegion, setOrgRegion] = useState(editUser?.org_region ?? "");
  const [district, setDistrict] = useState(editUser?.district ?? "");
  const [employeeLevel, setEmployeeLevel] = useState<EmployeeOrgLevel>(
    normalizeEmployeeLevel(editUser?.employee_level)
  );
  const [isActive, setIsActive] = useState(editUser?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEdit = !!editUser;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (isEdit) {
        const payload: UserUpdate = {
          full_name: fullName || null,
          province: province || null,
          org_region: orgRegion || null,
          district: district || null,
          employee_level: employeeLevel,
          is_active: isActive,
        };
        if (password.trim()) payload.password = password;
        // 仅在用户名实际发生变更时才提交，避免不必要的覆盖
        if (username.trim() && username.trim() !== editUser.username) {
          payload.username = username.trim();
        }
        await updateUser(editUser.id, payload);
      } else {
        if (!password.trim()) {
          setError("新建用户必须设置密码");
          setSaving(false);
          return;
        }
        const payload: UserCreate = {
          username,
          password,
          full_name: fullName || null,
          province: province || null,
          org_region: orgRegion || null,
          district: district || null,
          employee_level: employeeLevel,
          is_active: isActive,
        };
        await createUser(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative bg-background border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold">{isEdit ? "编辑用户" : "新建用户"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              用户名（工号）{!isEdit && " *"}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="登录用户名 / 工号"
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                修改工号将同步更新登录账号，请谨慎操作。
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              密码 {isEdit ? "(留空不修改)" : "*"}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!isEdit}
              minLength={6}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder={isEdit ? "留空不修改" : "至少 6 位"}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">姓名</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="真实姓名"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">大区</label>
              <input
                type="text"
                value={orgRegion}
                onChange={(e) => setOrgRegion(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="如: 西部大区（通讯录 daqua）"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">省份</label>
              <input
                type="text"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="如: 浙江省"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">区域/片区</label>
            <input
              type="text"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="如: 烟威、上海一区（通讯录 quyud）"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">员工等级</label>
              <select
                value={employeeLevel}
                onChange={(e) => setEmployeeLevel(e.target.value as EmployeeOrgLevel)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {EMPLOYEE_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">状态</label>
              <select
                value={isActive ? "active" : "inactive"}
                onChange={(e) => setIsActive(e.target.value === "active")}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg shadow-sm transition-all disabled:opacity-60 flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? "保存修改" : "创建用户"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Import Modal ─────────────────────────────────────────────────────────────

interface ImportModalProps {
  onClose: () => void;
  onDone: (result: UserImportResponse) => void;
}

interface SyncModalProps {
  onClose: () => void;
  onDone: (result: SyncOrgCsvResponse) => void;
}

function ImportModal({ onClose, onDone }: ImportModalProps) {
  const [mode, setMode] = useState<"csv" | "json">("csv");
  const [overwrite, setOverwrite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [jsonText, setJsonText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const result = await importUsersCsv(file, overwrite);
      onDone(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleJsonImport = async () => {
    setError("");
    try {
      const parsed = JSON.parse(jsonText);
      const users = Array.isArray(parsed) ? parsed : parsed.users;
      if (!Array.isArray(users) || users.length === 0) {
        setError("JSON 需要是用户数组，或包含 users 数组的对象");
        return;
      }
      setUploading(true);
      const result = await importUsers({ users, overwrite_existing: overwrite });
      onDone(result);
      onClose();
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("JSON 格式不合法");
      } else {
        setError(err instanceof Error ? err.message : "导入失败");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative bg-background border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Upload size={18} />
            导入用户
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex bg-muted/50 border rounded-full p-1 w-fit">
            <button
              onClick={() => setMode("csv")}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold transition-all",
                mode === "csv"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              CSV 文件
            </button>
            <button
              onClick={() => setMode("json")}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold transition-all",
                mode === "json"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              JSON 数据
            </button>
          </div>

          {/* Overwrite toggle */}
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            <span>覆盖已有用户（同 username 则更新信息）</span>
          </label>

          {mode === "csv" ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                CSV 必须包含 <code className="px-1 py-0.5 bg-muted rounded text-[11px]">username</code> 列。
                可选列：<code className="px-1 py-0.5 bg-muted rounded text-[11px]">password, full_name, province, org_region, employee_level, district, is_active</code>
              </p>
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg shadow-sm transition-all disabled:opacity-60"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  选择 CSV 文件上传
                </button>
              </div>
              <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 border border-dashed">
                <div className="font-medium mb-1">CSV 示例：</div>
                <pre className="text-[11px] overflow-x-auto">
{`username,password,full_name,province,employee_level,district
zhangsan,123456,张三,浙江省,staff,杭州市
lisi,123456,李四,浙江省,province_manager,
admin2,admin123,管理员2,,admin,`}
                </pre>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                粘贴 JSON 数组（或含 <code className="px-1 py-0.5 bg-muted rounded text-[11px]">users</code> 字段的对象），适合从其他系统 API 导入。
              </p>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 text-xs font-mono border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
                placeholder={`[\n  { "username": "zhangsan", "password": "123456", "full_name": "张三", "province": "浙江省", "employee_level": "staff", "district": "杭州市" }\n]`}
              />
              <button
                onClick={handleJsonImport}
                disabled={uploading || !jsonText.trim()}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg shadow-sm transition-all disabled:opacity-60"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                导入
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SyncOrgModal({ onClose, onDone }: SyncModalProps) {
  const [overwrite, setOverwrite] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState("123456");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSync = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await syncUsersFromOrgCsv(overwrite, defaultPassword || undefined);
      onDone(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative bg-background border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <GitBranch size={18} />
            同步通讯录到用户
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">
              {error}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            <span>覆盖已有用户信息（同 username）</span>
          </label>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">默认密码（新建账号使用）</label>
            <input
              type="text"
              value={defaultPassword}
              onChange={(e) => setDefaultPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background"
              minLength={6}
            />
          </div>
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 border border-dashed leading-relaxed">
            将从后端读取 <code className="px-1 py-0.5 bg-muted rounded text-[11px]">业务经理通讯录.csv</code>，
            按大区/省/区域/职务自动推断员工等级（大区总、省总、区域总、省区经理、区域经理、业务经理等），
            username 优先人员编码。
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border hover:bg-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSync}
              disabled={loading}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg flex items-center gap-2 disabled:opacity-60"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              开始同步
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

type OrgNode = OrgGraphNode & {
  children: OrgNode[];
  depth: number;
};

function inferScopeLabel(
  user: ReturnType<typeof useAuth>["user"]
):
  | "全量数据（管理员）"
  | "大区内范围"
  | "省总管辖范围"
  | "区域总管辖范围"
  | "省内范围"
  | "下级链路范围"
  | "仅本人" {
  if (!user) return "仅本人";
  if (user.roles.includes("admin")) return "全量数据（管理员）";
  switch (user.employee_level) {
    case "region_executive":
      return "大区内范围";
    case "province_executive":
      return "省总管辖范围";
    case "area_executive":
      return "区域总管辖范围";
    case "province_manager":
      return "省内范围";
    case "area_manager":
      return "下级链路范围";
    default:
      return "仅本人";
  }
}

function buildOrgForest(nodes: OrgGraphNode[], edges: Array<{ from: string; to: string }>): OrgNode[] {
  const base = new Map<string, OrgNode>();
  for (const n of nodes) {
    base.set(n.name, { ...n, children: [], depth: 0 });
  }
  const childNames = new Set<string>();
  // 用 Set 追踪每对 (parent, child) 避免重复添加（防御后端残余重复边）
  const addedEdges = new Set<string>();
  for (const e of edges) {
    const p = base.get(e.from);
    const c = base.get(e.to);
    if (!p || !c) continue;
    const key = `${e.from}\0${e.to}`;
    if (addedEdges.has(key)) continue;
    addedEdges.add(key);
    p.children.push(c);
    childNames.add(c.name);
  }
  let roots = Array.from(base.values()).filter((n) => !childNames.has(n.name));
  if (roots.length === 0) roots = Array.from(base.values());
  const setDepth = (node: OrgNode, d: number, visiting: Set<string>) => {
    if (visiting.has(node.name)) return;
    visiting.add(node.name);
    node.depth = d;
    node.children.forEach((ch) => setDepth(ch, d + 1, visiting));
    visiting.delete(node.name);
  };
  roots.forEach((r) => setDepth(r, 0, new Set<string>()));
  return roots.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function countDescendants(node: OrgNode, visiting = new Set<string>()): number {
  if (visiting.has(node.name)) return 0;
  visiting.add(node.name);
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child, visiting);
  }
  visiting.delete(node.name);
  return count;
}

function OrgTreeNode({
  node,
  selectedName,
  onSelect,
  path = new Set<string>(),
}: {
  node: OrgNode;
  selectedName: string;
  onSelect: (node: OrgNode) => void;
  path?: Set<string>;
}) {
  const hasCycle = path.has(node.name);
  const [expanded, setExpanded] = useState(node.depth < 1);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs w-5 h-5 rounded border hover:bg-muted"
            title={expanded ? "收起" : "展开"}
          >
            {expanded ? "-" : "+"}
          </button>
        ) : (
          <span className="inline-block w-5" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node)}
          className={cn(
            "text-left px-2 py-1 rounded-md text-sm hover:bg-muted w-full",
            selectedName === node.name && "bg-primary/10 border border-primary/30"
          )}
        >
          <div className="font-medium">{node.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {node.employee_code || "无工号"} {node.province ? `· ${node.province}` : ""}
          </div>
        </button>
      </div>
      {expanded && node.children.length > 0 && !hasCycle && (
        <div className="ml-6 border-l pl-3 space-y-1">
          {node.children
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
            .map((child) => (
              <OrgTreeNode
                key={`${node.name}-${child.name}`}
                node={child}
                selectedName={selectedName}
                onSelect={onSelect}
                path={new Set([...path, node.name])}
              />
            ))}
        </div>
      )}
      {hasCycle && (
        <div className="ml-7 text-[11px] text-amber-600 dark:text-amber-400">
          检测到循环引用，已停止继续展开
        </div>
      )}
    </div>
  );
}

function UsersPageInner() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgLoading, setOrgLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProvince, setFilterProvince] = useState("");
  const [filterLevel, setFilterLevel] = useState("");
  const [activeTab, setActiveTab] = useState<"list" | "org">("list");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [importResult, setImportResult] = useState<UserImportResponse | null>(null);
  const [syncResult, setSyncResult] = useState<SyncOrgCsvResponse | null>(null);
  const [orgNodes, setOrgNodes] = useState<OrgGraphNode[]>([]);
  const [orgEdges, setOrgEdges] = useState<Array<{ from: string; to: string }>>([]);
  const [selectedOrgName, setSelectedOrgName] = useState("");

  const isAdmin = currentUser?.roles.includes("admin");
  const scopeLabel = inferScopeLabel(currentUser);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const pageSize = 200;
      let skip = 0;
      const all: User[] = [];
      while (true) {
        const chunk = await fetchUsers(
          filterProvince || undefined,
          filterLevel || undefined,
          skip,
          pageSize
        );
        all.push(...chunk);
        if (chunk.length < pageSize) break;
        skip += pageSize;
        // Safety guard for unexpected backend paging behavior.
        if (skip > 20000) break;
      }
      setUsers(all);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterProvince, filterLevel]);

  const loadOrgGraph = useCallback(async () => {
    setOrgLoading(true);
    try {
      const data = await fetchOrgGraph();
      setOrgNodes(data.nodes);
      setOrgEdges(data.edges.map((e) => ({ from: e.from, to: e.to })));
      if (!selectedOrgName && data.nodes.length > 0) {
        setSelectedOrgName(data.nodes[0].name);
      }
    } finally {
      setOrgLoading(false);
    }
  }, [selectedOrgName]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (activeTab === "org") {
      loadOrgGraph();
    }
  }, [activeTab, loadOrgGraph]);

  const handleDelete = async (u: User) => {
    if (!confirm(`确定删除用户 "${u.username}" (${u.full_name || "无姓名"})？`)) return;
    try {
      await deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleImportDone = (result: UserImportResponse) => {
    setImportResult(result);
    loadUsers();
  };
  const handleSyncDone = (result: SyncOrgCsvResponse) => {
    setSyncResult(result);
    loadUsers();
    if (activeTab === "org") loadOrgGraph();
  };

  // Derive unique provinces from loaded users
  const provinces = Array.from(new Set(users.map((u) => u.province).filter(Boolean))) as string[];

  // Client-side search filter
  const filtered = users.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      u.username.toLowerCase().startsWith(q) ||
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.province || "").toLowerCase().includes(q) ||
      (u.org_region || "").toLowerCase().includes(q) ||
      (u.district || "").toLowerCase().includes(q)
    );
  });

  const handleDownloadTemplate = () => {
    const csv =
      "username,password,full_name,province,org_region,employee_level,district,is_active\nzhangsan,123456,张三,浙江省,东部大区,staff,杭州市,true\nlisi,123456,李四,山东省,东部大区,province_manager,,true\n";
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const forest = buildOrgForest(orgNodes, orgEdges);
  const selectedOrgNode = (() => {
    const map = new Map(forest.flatMap((r) => {
      const acc: OrgNode[] = [];
      const seen = new Set<string>();
      const visit = (n: OrgNode) => {
        if (seen.has(n.name)) return;
        seen.add(n.name);
        acc.push(n);
        n.children.forEach(visit);
      };
      visit(r);
      return acc.map((x) => [x.name, x] as const);
    }));
    return map.get(selectedOrgName) || null;
  })();

  return (
    <div className="min-h-screen bg-app-bg flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded-lg border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
            title="返回首页"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shadow-sm border border-primary/20">
            <Users size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">用户管理</h1>
            <p className="text-[10px] text-muted-foreground font-medium">
              管理系统用户、组织层级与权限
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Link
                href="/admin"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-full border bg-background hover:bg-accent transition-all"
              >
                <Users size={14} />
                元数据
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-full border bg-background hover:bg-accent transition-all"
              >
                <Settings size={14} />
                配置
              </Link>
            </div>
          )}
          <ThemeToggle className="p-2 rounded-full border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-all" />
          <UserChip />
        </div>
      </header>

      <div className="px-4 sm:px-8 py-2 border-b bg-background/60">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex bg-muted/50 border rounded-full p-1 w-fit">
            <button
              onClick={() => setActiveTab("list")}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold transition-all",
                activeTab === "list"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              用户列表
            </button>
            <button
              onClick={() => setActiveTab("org")}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold transition-all",
                activeTab === "org"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              组织架构
            </button>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <Shield size={12} />
            当前可见范围：{scopeLabel}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-4 sm:px-8 py-4 border-b bg-background/50">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索工号(优先前缀) / 姓名 / 区域..."
                className="pl-9 pr-3 py-2 text-sm border rounded-lg bg-background w-52 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {/* Province filter */}
            <select
              value={filterProvince}
              onChange={(e) => setFilterProvince(e.target.value)}
              className="px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">全部省份</option>
              {provinces.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            {/* Level filter */}
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">全部等级</option>
              {EMPLOYEE_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {isAdmin && activeTab === "list" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSyncModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <GitBranch size={14} />
                同步通讯录
              </button>
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <Download size={14} />
                下载模板
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <Upload size={14} />
                导入用户
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg shadow-sm transition-all"
              >
                <UserPlus size={14} />
                新建用户
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className="px-4 sm:px-8 py-3 bg-green-50 dark:bg-green-900/20 border-b">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="text-sm">
              <span className="font-semibold text-green-700 dark:text-green-400">导入完成：</span>
              共 {importResult.total} 条，
              新建 <span className="font-bold">{importResult.created}</span>，
              更新 <span className="font-bold">{importResult.updated}</span>，
              跳过 {importResult.skipped}
              {importResult.errors.length > 0 && (
                <span className="text-destructive ml-2">
                  ({importResult.errors.length} 个错误)
                </span>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="p-1 rounded hover:bg-muted">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {syncResult && (
        <div className="px-4 sm:px-8 py-3 bg-blue-50 dark:bg-blue-900/20 border-b">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="text-sm">
              <span className="font-semibold text-blue-700 dark:text-blue-400">通讯录同步完成：</span>
              共 {syncResult.total} 条，
              新建 <span className="font-bold">{syncResult.created}</span>，
              更新 <span className="font-bold">{syncResult.updated}</span>，
              跳过 {syncResult.skipped}
            </div>
            <button onClick={() => setSyncResult(null)} className="p-1 rounded hover:bg-muted">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* User table */}
      <div className="flex-1 px-4 sm:px-8 py-6">
        <div className="max-w-7xl mx-auto">
          {activeTab === "list" && loading ? (
            <div className="flex items-center justify-center py-20 gap-3">
              <Loader2 size={20} className="animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">加载用户列表...</span>
            </div>
          ) : activeTab === "list" && filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center border">
                <Users size={28} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">暂无用户数据</p>
                <p className="text-xs text-muted-foreground mt-1">点击「新建用户」或「导入用户」添加</p>
              </div>
            </div>
          ) : activeTab === "list" ? (
            <div className="border rounded-xl overflow-hidden bg-background shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">工号</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">姓名</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">员工等级</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">大区</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">省份</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">区域/片区</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">状态</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">创建时间</th>
                      {isAdmin && (
                        <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">操作</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                              {(u.full_name || u.username)[0]?.toUpperCase()}
                            </div>
                            <span className="font-medium">{u.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {u.full_name || <span className="italic text-muted-foreground/50">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold",
                            LEVEL_COLORS[u.employee_level] || LEVEL_COLORS.staff
                          )}>
                            {LEVEL_LABELS[u.employee_level] || u.employee_level}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {u.org_region || <span className="text-muted-foreground/50">-</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {u.province || <span className="text-muted-foreground/50">-</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {u.district || <span className="text-muted-foreground/50">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
                            u.is_active
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}>
                            <span className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              u.is_active ? "bg-green-500" : "bg-red-500"
                            )} />
                            {u.is_active ? "启用" : "停用"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setEditTarget(u)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                title="编辑"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(u)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                title="删除"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t bg-muted/20 text-xs text-muted-foreground">
                共 {filtered.length} 个用户
                {searchQuery && ` (搜索自 ${users.length} 个)`}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 border rounded-xl bg-background shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">组织架构树</h3>
                  <button
                    type="button"
                    onClick={loadOrgGraph}
                    className="text-xs px-2 py-1 border rounded-md hover:bg-muted"
                  >
                    刷新
                  </button>
                </div>
                {orgLoading ? (
                  <div className="py-12 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    加载组织架构...
                  </div>
                ) : forest.length === 0 ? (
                  <div className="py-12 text-sm text-muted-foreground">
                    暂无组织数据，可先执行“同步通讯录”。
                  </div>
                ) : (
                  <div className="max-h-[65vh] overflow-auto space-y-2 pr-1">
                    {forest.map((root) => (
                      <OrgTreeNode
                        key={root.name}
                        node={root}
                        selectedName={selectedOrgName}
                        onSelect={(n) => setSelectedOrgName(n.name)}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="border rounded-xl bg-background shadow-sm p-4 space-y-3">
                <h3 className="text-sm font-semibold">节点详情</h3>
                {!selectedOrgNode ? (
                  <p className="text-sm text-muted-foreground">点击左侧节点查看详情</p>
                ) : (
                  <>
                    <div>
                      <div className="text-lg font-bold">{selectedOrgNode.name}</div>
                      <div className="text-xs text-muted-foreground">
                        工号：{selectedOrgNode.employee_code || "无"}
                      </div>
                    </div>
                    <div className="text-sm space-y-1">
                      <div>职位：{selectedOrgNode.title || "未标注"}</div>
                      <div>省份：{selectedOrgNode.province || "未标注"}</div>
                      <div>区域：{selectedOrgNode.region || "未标注"}</div>
                      <div>区县：{selectedOrgNode.district || "未标注"}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                      下级总数：<span className="font-semibold">{countDescendants(selectedOrgNode)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <UserFormModal onClose={() => setShowCreateModal(false)} onSaved={loadUsers} />
      )}
      {editTarget && (
        <UserFormModal
          editUser={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={loadUsers}
        />
      )}
      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onDone={handleImportDone}
        />
      )}
      {showSyncModal && (
        <SyncOrgModal
          onClose={() => setShowSyncModal(false)}
          onDone={handleSyncDone}
        />
      )}
    </div>
  );
}

export default function UsersPage() {
  return (
    <AuthGuard>
      <UsersPageInner />
    </AuthGuard>
  );
}
