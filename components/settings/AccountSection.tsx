import React, { useState } from "react";
import { apiService } from "../../services/apiService";
import { useApp } from "../../store/appStore";
import { useI18n } from "../../lib/i18n";

/** store 里的 currentUser 是宽松对象，这里只收窄到界面真正读到的字段 */
interface AccountUser {
    id?: string;
    username?: string;
    email?: string;
    createdAt?: string;
}

interface ProfileForm {
    username: string;
    email: string;
}

interface PasswordForm {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
}

type Feedback = { type: "success" | "error"; text: string } | null;

const EMPTY_PASSWORD_FORM: PasswordForm = {
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
};

const cardClass = "rounded-lg border border-cad-border bg-cad-panel p-4 space-y-3";
const inputClass =
    "w-full h-8 bg-transparent border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none";
const labelClass = "text-xs font-bold text-cad-muted";
const primaryButtonClass =
    "flex-1 py-2 px-3 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors";
const ghostButtonClass =
    "flex-1 py-2 px-3 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors";

function FeedbackBanner({ message }: { message: Feedback }) {
    if (!message) return null;
    return (
        <div
            className={`p-3 rounded-lg border text-xs ${
                message.type === "success"
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}
        >
            {message.text}
        </div>
    );
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export interface AccountSectionProps {
    onLogout?: () => void;
}

/**
 * 用户管理：资料与密码修改从 RightPanel 迁出。
 * 编辑态仍然替换正文而不是弹层，行为与旧面板一致。
 */
export const AccountSection: React.FC<AccountSectionProps> = ({ onLogout }) => {
    const { t } = useI18n();
    const { state } = useApp();
    const currentUser = state.currentUser as AccountUser | null;

    const [editingProfile, setEditingProfile] = useState(false);
    const [editingPassword, setEditingPassword] = useState(false);
    const [profileForm, setProfileForm] = useState<ProfileForm>({ username: "", email: "" });
    const [passwordForm, setPasswordForm] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
    const [message, setMessage] = useState<Feedback>(null);

    const openProfileEditor = () => {
        setMessage(null);
        setEditingPassword(false);
        setProfileForm({ username: currentUser?.username ?? "", email: currentUser?.email ?? "" });
        setEditingProfile(true);
    };

    const openPasswordEditor = () => {
        setMessage(null);
        setEditingProfile(false);
        setPasswordForm(EMPTY_PASSWORD_FORM);
        setEditingPassword(true);
    };

    async function saveProfile() {
        try {
            await apiService.updateProfile({
                username: profileForm.username,
                email: profileForm.email,
            });
            setMessage({ type: "success", text: t("profile.updated") });
            window.setTimeout(() => setEditingProfile(false), 1500);
        } catch (error) {
            setMessage({ type: "error", text: errorMessage(error, t("profile.updateFailed")) });
        }
    }

    async function savePassword() {
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setMessage({ type: "error", text: t("profile.passwordMismatch") });
            return;
        }
        if (passwordForm.newPassword.length < 6) {
            setMessage({ type: "error", text: t("profile.passwordTooShort") });
            return;
        }
        try {
            await apiService.changePassword({
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword,
            });
            setMessage({ type: "success", text: t("profile.passwordChanged") });
            window.setTimeout(() => {
                setEditingPassword(false);
                setPasswordForm(EMPTY_PASSWORD_FORM);
            }, 1500);
        } catch (error) {
            setMessage({
                type: "error",
                text: errorMessage(error, t("profile.passwordChangeFailed")),
            });
        }
    }

    if (editingProfile) {
        return (
            <div className="max-w-xl space-y-4">
                <div className={cardClass}>
                    <h4 className="text-sm font-bold text-cad-text">{t("panel.editProfile")}</h4>
                    <p className="text-[11px] text-cad-muted">{t("panel.updateInfo")}</p>
                    <label className="block space-y-2">
                        <span className={labelClass}>{t("profile.username")}</span>
                        <input
                            type="text"
                            value={profileForm.username}
                            onChange={(e) =>
                                setProfileForm({ ...profileForm, username: e.target.value })
                            }
                            className={inputClass}
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className={labelClass}>{t("profile.email")}</span>
                        <input
                            type="email"
                            value={profileForm.email}
                            onChange={(e) =>
                                setProfileForm({ ...profileForm, email: e.target.value })
                            }
                            className={inputClass}
                        />
                    </label>
                    <FeedbackBanner message={message} />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => {
                            setEditingProfile(false);
                            setMessage(null);
                        }}
                        className={ghostButtonClass}
                    >
                        {t("profile.cancel")}
                    </button>
                    <button onClick={() => void saveProfile()} className={primaryButtonClass}>
                        {t("profile.saveChanges")}
                    </button>
                </div>
            </div>
        );
    }

    if (editingPassword) {
        return (
            <div className="max-w-xl space-y-4">
                <div className={cardClass}>
                    <h4 className="text-sm font-bold text-cad-text">
                        {t("profile.changePassword")}
                    </h4>
                    <p className="text-[11px] text-cad-muted">{t("profile.changePasswordHint")}</p>
                    <label className="block space-y-2">
                        <span className={labelClass}>{t("profile.currentPassword")}</span>
                        <input
                            type="password"
                            value={passwordForm.currentPassword}
                            onChange={(e) =>
                                setPasswordForm({
                                    ...passwordForm,
                                    currentPassword: e.target.value,
                                })
                            }
                            placeholder={t("profile.currentPasswordPlaceholder")}
                            className={inputClass}
                            autoComplete="current-password"
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className={labelClass}>{t("profile.newPassword")}</span>
                        <input
                            type="password"
                            value={passwordForm.newPassword}
                            onChange={(e) =>
                                setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                            }
                            placeholder={t("profile.newPasswordPlaceholder")}
                            className={inputClass}
                            autoComplete="new-password"
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className={labelClass}>{t("profile.confirmPassword")}</span>
                        <input
                            type="password"
                            value={passwordForm.confirmPassword}
                            onChange={(e) =>
                                setPasswordForm({
                                    ...passwordForm,
                                    confirmPassword: e.target.value,
                                })
                            }
                            placeholder={t("profile.confirmPasswordPlaceholder")}
                            className={inputClass}
                            autoComplete="new-password"
                        />
                    </label>
                    <FeedbackBanner message={message} />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => {
                            setEditingPassword(false);
                            setPasswordForm(EMPTY_PASSWORD_FORM);
                            setMessage(null);
                        }}
                        className={ghostButtonClass}
                    >
                        {t("profile.cancel")}
                    </button>
                    <button onClick={() => void savePassword()} className={primaryButtonClass}>
                        {t("profile.updatePassword")}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <section className={`${cardClass} lg:col-span-2 flex flex-col items-center py-6`}>
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] flex items-center justify-center text-white text-2xl font-bold shadow-lg mb-4">
                    {(currentUser?.username ?? "").substring(0, 2).toUpperCase() || "U"}
                </div>
                <h4 className="text-lg font-bold text-cad-text">
                    {currentUser?.username || t("profile.userFallback")}
                </h4>
                <p className="text-xs text-cad-muted mt-1">{currentUser?.email || ""}</p>
                <span className="mt-3 px-3 py-1 bg-cad-primary/20 text-cad-primary text-xs font-semibold rounded-full border border-cad-primary/30">
                    {t("profile.engineer")}
                </span>
            </section>

            <section className={cardClass}>
                <h5 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                    {t("profile.accountDetails")}
                </h5>
                <div className="rounded-lg border border-cad-border bg-cad-bg p-3 space-y-2">
                    <div className="flex justify-between items-center gap-2">
                        <span className="text-xs text-cad-muted">{t("profile.userId")}</span>
                        <span className="text-xs font-mono text-cad-text truncate max-w-[180px]">
                            {currentUser?.id || t("profile.na")}
                        </span>
                    </div>
                    <div className="flex justify-between items-center gap-2">
                        <span className="text-xs text-cad-muted">{t("profile.memberSince")}</span>
                        <span className="text-xs text-cad-text">
                            {currentUser?.createdAt
                                ? new Date(currentUser.createdAt).toLocaleDateString()
                                : t("profile.na")}
                        </span>
                    </div>
                </div>
                <FeedbackBanner message={message} />
            </section>

            <section className={cardClass}>
                <h5 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                    {t("profile.quickActions")}
                </h5>
                <div className="space-y-2">
                    <button
                        onClick={openProfileEditor}
                        className="w-full flex items-center gap-3 p-3 bg-cad-bg hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
                    >
                        <span className="material-symbols-outlined text-[18px] text-cad-primary">
                            account_circle
                        </span>
                        <div>
                            <p className="text-xs font-semibold text-cad-text">
                                {t("panel.editProfile")}
                            </p>
                            <p className="text-[10px] text-cad-muted">{t("panel.updateInfo")}</p>
                        </div>
                    </button>

                    <button
                        onClick={openPasswordEditor}
                        className="w-full flex items-center gap-3 p-3 bg-cad-bg hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
                    >
                        <span className="material-symbols-outlined text-[18px] text-cad-primary">
                            security
                        </span>
                        <div>
                            <p className="text-xs font-semibold text-cad-text">
                                {t("profile.changePassword")}
                            </p>
                            <p className="text-[10px] text-cad-muted">
                                {t("profile.changePasswordHint")}
                            </p>
                        </div>
                    </button>

                    <a
                        href="https://github.com/AIIgnite/AIIgniteCAD/issues"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center gap-3 p-3 bg-cad-bg hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
                    >
                        <span className="material-symbols-outlined text-[18px] text-cad-primary">
                            help
                        </span>
                        <div>
                            <p className="text-xs font-semibold text-cad-text">
                                {t("profile.helpSupport")}
                            </p>
                            <p className="text-[10px] text-cad-muted">
                                {t("profile.getAssistance")}
                            </p>
                        </div>
                    </a>
                </div>
            </section>

            <div className="lg:col-span-2 pt-2">
                <button
                    onClick={onLogout}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 rounded-lg border border-red-500/30 transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">logout</span>
                    <span className="text-xs font-bold">{t("panel.logout")}</span>
                </button>
            </div>
        </div>
    );
};

export default AccountSection;
