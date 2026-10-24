/**
 * UsersSection.tsx — 设置页「用户管理」分区（仅管理员可见）
 *
 * 主从布局：左侧用户列表，点击进入右侧详情才能调整角色；
 * 与图纸管理分区同一套版式，动作结果以行内提示回显。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiService, type ManagedUser } from "../../services/apiService";
import { useI18n } from "../../lib/i18n";

const UsersSection: React.FC = () => {
    const { t } = useI18n();
    const [users, setUsers] = useState<ManagedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [pendingRole, setPendingRole] = useState<"admin" | "user" | null>(null);
    const [hint, setHint] = useState<string | null>(null);

    /** 失败后可手动重拉；effect 里的首次加载走 then 链避免同步 setState */
    const load = useCallback(async () => {
        setError(null);
        try {
            const { users: list } = await apiService.listUsers();
            setUsers(list);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        apiService
            .listUsers()
            .then(({ users: list }) => {
                if (!cancelled) setUsers(list);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const filtered = useMemo(
        () =>
            users.filter((user) =>
                `${user.username} ${user.email}`
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
            ),
        [users, searchQuery],
    );

    const selected =
        filtered.find((user) => user.id === selectedId) ??
        (users.find((user) => user.id === selectedId) ?? null);

    const applyRole = async (user: ManagedUser, role: "admin" | "user") => {
        setHint(null);
        try {
            const { user: updated } = await apiService.updateUserRole(user.id, role);
            setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            setPendingRole(null);
            setHint(t("users.roleUpdated", { name: updated.username }));
        } catch (e) {
            setHint(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <div className="h-full flex gap-4 min-h-0">
            {/* 主视图：用户列表 */}
            <div className="w-80 shrink-0 flex flex-col rounded-lg border border-cad-border bg-cad-panel">
                <div className="p-3 space-y-2 border-b border-cad-border">
                    <div className="relative">
                        <span className="material-symbols-outlined text-[16px] text-cad-muted absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                            search
                        </span>
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={t("users.search")}
                            aria-label={t("users.search")}
                            className="w-full h-8 pl-8 pr-2 rounded bg-cad-bg border border-cad-border text-xs text-cad-text focus:border-cad-primary outline-none"
                        />
                    </div>
                    <p className="font-mono text-[10px] text-cad-muted">
                        {t("users.count", { count: filtered.length })}
                    </p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
                    {loading && (
                        <div className="p-6 text-center text-xs text-cad-muted">
                            {t("users.loading")}
                        </div>
                    )}
                    {!loading && error && (
                        <div className="p-4 text-center text-xs text-red-500 dark:text-red-400">
                            {error}
                        </div>
                    )}
                    {!loading &&
                        !error &&
                        filtered.map((user) => {
                            const isSelected = selected?.id === user.id;
                            return (
                                <button
                                    key={user.id}
                                    data-testid="user-item"
                                    onClick={() => {
                                        setSelectedId(user.id);
                                        setPendingRole(null);
                                        setHint(null);
                                    }}
                                    aria-current={isSelected ? "true" : undefined}
                                    className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                                        isSelected
                                            ? "bg-cad-primary/10 border-cad-primary/40"
                                            : "border-transparent hover:bg-cad-text/5 hover:border-cad-border"
                                    }`}
                                >
                                    <span className="size-8 rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                                        {user.username.substring(0, 2).toUpperCase()}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-xs font-medium text-cad-text truncate">
                                            {user.username}
                                        </span>
                                        <span className="block text-[10px] text-cad-muted truncate">
                                            {user.email}
                                        </span>
                                    </span>
                                    {user.role === "admin" && (
                                        <span className="shrink-0 text-[10px] font-bold text-cad-primary">
                                            {t("users.roleAdmin")}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                </div>
            </div>

            {/* 从视图：选中用户的详情与角色编辑 */}
            <div className="flex-1 min-w-0 rounded-lg border border-cad-border bg-cad-panel p-5 overflow-y-auto">
                {selected ? (
                    <div className="max-w-xl space-y-5" data-testid="user-detail">
                        <div className="flex items-center gap-3">
                            <span className="size-12 rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] text-white flex items-center justify-center text-sm font-bold shrink-0">
                                {selected.username.substring(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                                <h4 className="text-base font-bold text-cad-text truncate">
                                    {selected.username}
                                </h4>
                                <p className="text-[11px] text-cad-muted truncate">
                                    {selected.email}
                                </p>
                            </div>
                        </div>

                        <dl className="rounded-lg border border-cad-border bg-cad-bg p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <dt className="text-cad-muted">{t("users.roleLabel")}</dt>
                            <dd className="text-cad-text font-bold">
                                {selected.role === "admin"
                                    ? t("users.roleAdmin")
                                    : t("users.roleUser")}
                            </dd>
                            <dt className="text-cad-muted">{t("users.projectCount")}</dt>
                            <dd className="text-cad-text font-mono">
                                {selected._count?.projects ?? 0}
                            </dd>
                            <dt className="text-cad-muted">{t("users.joinedAt")}</dt>
                            <dd className="text-cad-text font-mono">
                                {new Date(selected.createdAt).toLocaleString()}
                            </dd>
                        </dl>

                        <div className="space-y-2">
                            <p className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                                {t("users.changeRole")}
                            </p>
                            <div className="flex rounded border border-cad-border overflow-hidden w-fit">
                                {(["user", "admin"] as const).map((role) => (
                                    <button
                                        key={role}
                                        data-action={`user-role-${role}`}
                                        onClick={() => setPendingRole(role)}
                                        aria-pressed={pendingRole === role}
                                        className={`px-4 py-1.5 text-xs transition-colors ${
                                            (pendingRole ?? selected.role) === role
                                                ? "bg-cad-primary text-white"
                                                : "text-cad-muted hover:bg-cad-border/50"
                                        }`}
                                    >
                                        {role === "admin"
                                            ? t("users.roleAdmin")
                                            : t("users.roleUser")}
                                    </button>
                                ))}
                            </div>
                            {pendingRole && pendingRole !== selected.role && (
                                <div className="flex items-center gap-2">
                                    <button
                                        data-action="apply-user-role"
                                        onClick={() => void applyRole(selected, pendingRole)}
                                        className="h-7 px-3 rounded bg-cad-primary text-white text-[11px] font-bold hover:bg-cad-primaryHover transition-colors"
                                    >
                                        {t("users.applyRole")}
                                    </button>
                                    <button
                                        onClick={() => setPendingRole(null)}
                                        className="text-[11px] text-cad-muted hover:text-cad-text"
                                    >
                                        {t("common.cancel")}
                                    </button>
                                </div>
                            )}
                            {selected.role === "admin" && pendingRole === "user" && (
                                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                    {t("users.demoteWarning")}
                                </p>
                            )}
                            {hint && (
                                <p className="text-[11px] text-cad-muted" role="status">
                                    {hint}
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-cad-muted">
                        <span className="material-symbols-outlined text-[40px] opacity-20">
                            touch_app
                        </span>
                        <p className="text-xs">{t("users.selectHint")}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UsersSection;
