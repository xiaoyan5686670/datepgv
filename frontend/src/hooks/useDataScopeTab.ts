"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bulkSetScopePoliciesEnabled,
  createProvinceAlias,
  createScopePolicy,
  deleteProvinceAlias,
  deleteScopePolicy,
  fetchProvinceAliases,
  fetchScopePolicies,
  updateProvinceAlias,
  updateScopePolicy,
} from "@/lib/api";
import type { DataScopePolicy, ProvinceAlias } from "@/types";

export type ScopeFormState = {
  subject_type: DataScopePolicy["subject_type"];
  subject_key: string;
  dimension: DataScopePolicy["dimension"];
  allowed_values: string;
  deny_values: string;
  merge_mode: DataScopePolicy["merge_mode"];
  priority: number;
  enabled: boolean;
  note: string;
};

const defaultScopeForm = (): ScopeFormState => ({
  subject_type: "level",
  subject_key: "",
  dimension: "province",
  allowed_values: "",
  deny_values: "",
  merge_mode: "union",
  priority: 100,
  enabled: true,
  note: "",
});

type UseDataScopeTabOptions = {
  /** 递增时重新拉取策略与省份别名（供设置页顶栏刷新） */
  refreshTick?: number;
};

export function useDataScopeTab(options: UseDataScopeTabOptions = {}) {
  const { refreshTick = 0 } = options;
  const [scopePolicies, setScopePolicies] = useState<DataScopePolicy[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeBulkLoading, setScopeBulkLoading] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<number | null>(null);
  const [showScopeEditor, setShowScopeEditor] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeDimensionFilter, setScopeDimensionFilter] = useState<
    "all" | DataScopePolicy["dimension"]
  >("all");
  const [scopeSubjectFilter, setScopeSubjectFilter] = useState<
    "all" | DataScopePolicy["subject_type"]
  >("all");
  const [scopeEnabledFilter, setScopeEnabledFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<number[]>([]);
  const [scopeForm, setScopeForm] = useState<ScopeFormState>(defaultScopeForm());

  const [provinceAliases, setProvinceAliases] = useState<ProvinceAlias[]>([]);
  const [provinceAliasLoading, setProvinceAliasLoading] = useState(false);
  const [provinceAliasSaving, setProvinceAliasSaving] = useState(false);
  const [editingProvinceAliasId, setEditingProvinceAliasId] = useState<number | null>(null);
  const [provinceAliasForm, setProvinceAliasForm] = useState({
    canonical_name: "",
    alias: "",
    priority: 100,
    enabled: true,
  });
  const [aliasesExpanded, setAliasesExpanded] = useState(false);

  const loadScopePolicies = useCallback(async () => {
    setScopeLoading(true);
    try {
      setScopePolicies(await fetchScopePolicies());
    } catch (err) {
      alert(err instanceof Error ? err.message : "加载权限策略失败");
    } finally {
      setScopeLoading(false);
    }
  }, []);

  const loadProvinceAliases = useCallback(async () => {
    setProvinceAliasLoading(true);
    try {
      setProvinceAliases(await fetchProvinceAliases());
    } catch (err) {
      alert(err instanceof Error ? err.message : "加载省份别名失败");
    } finally {
      setProvinceAliasLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScopePolicies();
    void loadProvinceAliases();
  }, [loadScopePolicies, loadProvinceAliases, refreshTick]);

  const filteredSortedScopePolicies = useMemo(() => {
    const q = scopeQuery.trim().toLowerCase();
    const filtered = scopePolicies.filter((p) => {
      const matchesQuery =
        !q ||
        `${p.subject_type}:${p.subject_key}`.toLowerCase().includes(q) ||
        (p.note ?? "").toLowerCase().includes(q) ||
        p.allowed_values.join(",").toLowerCase().includes(q) ||
        p.deny_values.join(",").toLowerCase().includes(q);
      const matchesDimension =
        scopeDimensionFilter === "all" || p.dimension === scopeDimensionFilter;
      const matchesSubject =
        scopeSubjectFilter === "all" || p.subject_type === scopeSubjectFilter;
      const matchesEnabled =
        scopeEnabledFilter === "all" ||
        (scopeEnabledFilter === "enabled" ? p.enabled : !p.enabled);
      return matchesQuery && matchesDimension && matchesSubject && matchesEnabled;
    });
    return [...filtered].sort((a, b) => a.priority - b.priority || a.id - b.id);
  }, [
    scopePolicies,
    scopeQuery,
    scopeDimensionFilter,
    scopeSubjectFilter,
    scopeEnabledFilter,
  ]);

  const allFilteredSelected =
    filteredSortedScopePolicies.length > 0 &&
    filteredSortedScopePolicies.every((p) => selectedPolicyIds.includes(p.id));

  const toggleSelectFiltered = useCallback(() => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredSortedScopePolicies.map((p) => p.id));
      setSelectedPolicyIds((prev) => prev.filter((id) => !filteredIds.has(id)));
      return;
    }
    setSelectedPolicyIds((prev) => {
      const out = new Set(prev);
      filteredSortedScopePolicies.forEach((p) => out.add(p.id));
      return [...out];
    });
  }, [allFilteredSelected, filteredSortedScopePolicies]);

  const applyBulkEnabled = async (enabled: boolean) => {
    if (!selectedPolicyIds.length) return;
    setScopeBulkLoading(true);
    try {
      await bulkSetScopePoliciesEnabled(selectedPolicyIds, enabled);
      await loadScopePolicies();
      setSelectedPolicyIds([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "批量更新策略失败");
    } finally {
      setScopeBulkLoading(false);
    }
  };

  const resetScopeEditor = useCallback(() => {
    setEditingPolicyId(null);
    setScopeForm(defaultScopeForm());
  }, []);

  const resetProvinceAliasEditor = useCallback(() => {
    setEditingProvinceAliasId(null);
    setProvinceAliasForm({
      canonical_name: "",
      alias: "",
      priority: 100,
      enabled: true,
    });
  }, []);

  const submitProvinceAlias = async () => {
    if (!provinceAliasForm.canonical_name.trim() || !provinceAliasForm.alias.trim()) {
      alert("请填写标准名与别名");
      return;
    }
    setProvinceAliasSaving(true);
    try {
      const payload = {
        canonical_name: provinceAliasForm.canonical_name.trim(),
        alias: provinceAliasForm.alias.trim(),
        priority: provinceAliasForm.priority,
        enabled: provinceAliasForm.enabled,
      };
      if (editingProvinceAliasId) {
        await updateProvinceAlias(editingProvinceAliasId, payload);
      } else {
        await createProvinceAlias(payload);
      }
      await loadProvinceAliases();
      resetProvinceAliasEditor();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存省份别名失败");
    } finally {
      setProvinceAliasSaving(false);
    }
  };

  const removeProvinceAlias = async (id: number) => {
    if (!confirm(`确认删除省份别名 #${id} ?`)) return;
    await deleteProvinceAlias(id);
    await loadProvinceAliases();
    if (editingProvinceAliasId === id) {
      resetProvinceAliasEditor();
    }
  };

  const openNewPolicy = () => {
    resetScopeEditor();
    setShowScopeEditor(true);
  };

  const openEditPolicy = (p: DataScopePolicy) => {
    setEditingPolicyId(p.id);
    setScopeForm({
      subject_type: p.subject_type,
      subject_key: p.subject_key,
      dimension: p.dimension,
      allowed_values: p.allowed_values.join(","),
      deny_values: p.deny_values.join(","),
      merge_mode: p.merge_mode,
      priority: p.priority,
      enabled: p.enabled,
      note: p.note ?? "",
    });
    setShowScopeEditor(true);
  };

  const savePolicy = async () => {
    if (!scopeForm.subject_key.trim()) {
      alert("请填写主体标识（Subject Key）");
      return;
    }
    setScopeSaving(true);
    try {
      const payload = {
        ...scopeForm,
        allowed_values: scopeForm.allowed_values
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        deny_values: scopeForm.deny_values
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (editingPolicyId) {
        await updateScopePolicy(editingPolicyId, payload);
      } else {
        await createScopePolicy(payload);
      }
      await loadScopePolicies();
      resetScopeEditor();
      setShowScopeEditor(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存策略失败");
    } finally {
      setScopeSaving(false);
    }
  };

  const deletePolicy = async (id: number) => {
    if (!confirm(`确认删除策略 #${id} ?`)) return;
    await deleteScopePolicy(id);
    await loadScopePolicies();
  };

  const closeEditor = () => {
    setShowScopeEditor(false);
    resetScopeEditor();
  };

  return {
    scopePolicies,
    scopeLoading,
    scopeSaving,
    scopeBulkLoading,
    editingPolicyId,
    showScopeEditor,
    scopeQuery,
    setScopeQuery,
    scopeDimensionFilter,
    setScopeDimensionFilter,
    scopeSubjectFilter,
    setScopeSubjectFilter,
    scopeEnabledFilter,
    setScopeEnabledFilter,
    selectedPolicyIds,
    setSelectedPolicyIds,
    filteredSortedScopePolicies,
    allFilteredSelected,
    toggleSelectFiltered,
    applyBulkEnabled,
    loadScopePolicies,
    scopeForm,
    setScopeForm,
    openNewPolicy,
    openEditPolicy,
    savePolicy,
    deletePolicy,
    closeEditor,
    provinceAliases,
    provinceAliasLoading,
    provinceAliasSaving,
    editingProvinceAliasId,
    setEditingProvinceAliasId,
    provinceAliasForm,
    setProvinceAliasForm,
    submitProvinceAlias,
    removeProvinceAlias,
    resetProvinceAliasEditor,
    aliasesExpanded,
    setAliasesExpanded,
  };
}

export type DataScopeTabState = ReturnType<typeof useDataScopeTab>;
