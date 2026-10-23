/**
 * ErrorBoundary.tsx — 全局渲染错误兜底
 *
 * 捕获渲染期异常，提供重试、刷新与复制诊断信息三个可操作出口；
 * 错误同时上报遥测，便于定位偶发崩溃。
 */

import React from "react";
import { telemetryService } from "../services/telemetryService";
import { useI18n } from "../lib/i18n";

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
    componentStack: string;
    copied: boolean;
}

export class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    declare props: Readonly<ErrorBoundaryProps>;

    state: ErrorBoundaryState = {
        error: null,
        componentStack: "",
        copied: false,
    };

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        const componentStack = info.componentStack ?? "";
        this.setState({ componentStack });
        telemetryService.captureError(error, {
            source: "react-error-boundary",
            componentStack: componentStack.slice(0, 2000),
        });
    }

    private retry = (): void => {
        this.setState({ error: null, componentStack: "", copied: false });
    };

    private reload = (): void => {
        window.location.reload();
    };

    private copyDetails = async (): Promise<void> => {
        const { error, componentStack } = this.state;
        const details = [
            `Message: ${error?.message ?? "Unknown error"}`,
            `Time: ${new Date().toISOString()}`,
            `URL: ${window.location.href}`,
            "",
            "Stack:",
            error?.stack ?? "(no stack)",
            "",
            "Component stack:",
            componentStack || "(no component stack)",
        ].join("\n");

        try {
            await navigator.clipboard.writeText(details);
            this.setState({ copied: true });
        } catch {
            this.setState({ copied: false });
        }
    };

    render(): React.ReactNode {
        const { error, componentStack, copied } = this.state;
        if (!error) return this.props.children;

        return (
            <ErrorFallback
                error={error}
                componentStack={componentStack}
                copied={copied}
                onRetry={this.retry}
                onReload={this.reload}
                onCopy={() => void this.copyDetails()}
            />
        );
    }
}

const ErrorFallback: React.FC<{
    error: Error;
    componentStack: string;
    copied: boolean;
    onRetry: () => void;
    onReload: () => void;
    onCopy: () => void;
}> = ({ error, componentStack, copied, onRetry, onReload, onCopy }) => {
    const { t } = useI18n();
    return (
        <div className="min-h-screen bg-cad-bg text-cad-text flex items-center justify-center p-6">
            <div className="w-full max-w-2xl bg-cad-panel border border-cad-border rounded-xl shadow-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-cad-border">
                    <h1 className="text-lg font-bold">{t("error.title")}</h1>
                    <p className="text-xs text-cad-muted mt-1">{t("error.subtitle")}</p>
                </div>

                <div className="p-5 space-y-4">
                    <div className="rounded border border-red-500/40 bg-red-500/10 p-3">
                        <p className="text-sm font-mono break-words">
                            {error.message || t("error.unknown")}
                        </p>
                    </div>

                    <details className="text-xs text-cad-muted">
                        <summary className="cursor-pointer hover:text-cad-text">
                            {t("error.technical")}
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                            {error.stack?.slice(0, 4000) ?? "(no stack)"}
                            {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
                        </pre>
                    </details>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                            onClick={onRetry}
                            className="px-3 py-1.5 rounded border border-cad-border text-xs font-bold hover:bg-cad-text/10"
                        >
                            {t("error.retry")}
                        </button>
                        <button
                            onClick={onReload}
                            className="px-3 py-1.5 rounded bg-cad-primary hover:bg-cad-primaryHover text-white text-xs font-bold"
                        >
                            {t("error.reload")}
                        </button>
                        <button
                            onClick={onCopy}
                            className="px-3 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                        >
                            {copied ? t("error.copied") : t("error.copy")}
                        </button>
                    </div>

                    <p className="text-[11px] text-cad-muted">{t("error.hint")}</p>
                </div>
            </div>
        </div>
    );
};

export default ErrorBoundary;
