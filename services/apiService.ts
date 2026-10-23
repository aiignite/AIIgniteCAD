import type {
    AgentChatRequest,
    AiSkill,
    AiSkillCandidate,
    AIUsageSummary,
    Assistant,
    AssistantInput,
    ChatLogMessage,
    ChatSessionInfo,
    DesignConventions,
    LLMModel,
    LLMModelInput,
    ProjectVersion,
    ProjectVersionSummary,
    SkillInput,
    SkillResolveInput,
} from "../types";
import { AIRequestError } from "../lib/aiErrors";
import { markSkillStatsDirty } from "../store/skillStats";
import {
    initialAgentTurn,
    parseSseLine,
    reduceAgentTurn,
    splitSseLines,
    type AgentEvent,
    type AgentTurnState,
} from "../lib/aiSseEvents";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3225/api";

export interface User {
    id: string;
    username: string;
    email: string;
    createdAt: string;
}

export interface ProjectFile {
    id: string;
    name: string;
    description?: string;
    lastModified: string;
    lastOpened?: string;
    thumbnail?: string;
    elementCount?: number;
}

/** 同步类接口的幂等键与冲突游标 */
export interface SyncRequestOptions {
    idempotencyKey?: string;
    baseUpdatedAt?: string;
}

export interface SaveElementsResponse {
    message: string;
    count: number;
    duplicate?: boolean;
    conflict?: boolean;
    serverUpdatedAt?: string;
    updatedAt?: string;
}

class ApiService {
    private token: string | null = null;

    constructor() {
        this.token =
            typeof localStorage === "undefined" ? null : localStorage.getItem("auth_token");
    }

    private getHeaders() {
        const headers: HeadersInit = {
            "Content-Type": "application/json",
        };

        if (this.token) {
            headers["Authorization"] = `Bearer ${this.token}`;
        }

        return headers;
    }

    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${API_BASE_URL}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                ...this.getHeaders(),
                ...(options.headers as Record<string, string> | undefined),
            },
        });

        const data = await response.json();

        if (!response.ok) {
            const error = new Error(data.message || "API request failed") as Error & {
                status?: number;
                code?: string;
                requestId?: string;
            };
            error.status = response.status;
            error.code = typeof data.code === "string" ? data.code : undefined;
            error.requestId = typeof data.requestId === "string" ? data.requestId : undefined;
            throw error;
        }

        return data;
    }

    setToken(token: string) {
        this.token = token;
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("auth_token", token);
        }
    }

    clearToken() {
        this.token = null;
        if (typeof localStorage !== "undefined") {
            localStorage.removeItem("auth_token");
        }
    }

    isAuthenticated(): boolean {
        return !!this.token;
    }

    async register(username: string, email: string, password: string) {
        const data = await this.request<{ token: string; user: User }>(`/auth/register`, {
            method: "POST",
            body: JSON.stringify({ username, email, password }),
        });
        this.setToken(data.token);
        return data;
    }

    async login(email: string, password: string) {
        const data = await this.request<{ token: string; user: User }>(`/auth/login`, {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
        this.setToken(data.token);
        return data;
    }

    async logout() {
        await this.request(`/auth/logout`, {
            method: "POST",
        });
        this.clearToken();
    }

    async getCurrentUser() {
        return this.request<{ user: User }>(`/auth/me`);
    }

    async updateProfile(data: { username?: string; email?: string }) {
        return this.request<{ user: User; message: string }>(`/auth/profile`, {
            method: "PUT",
            body: JSON.stringify(data),
        });
    }

    async changePassword(data: { currentPassword: string; newPassword: string }) {
        return this.request<{ message: string }>(`/auth/change-password`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    }

    async getProjects() {
        return this.request<{ projects: ProjectFile[]; total: number }>(`/projects`);
    }

    /** 上传 DWG 由后端 sidecar 转成 ASCII DXF，前端继续复用 parseDXF */
    async convertDwg(file: File) {
        const response = await fetch(`${API_BASE_URL}/import/dwg`, {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            },
            body: file,
        });

        // 网关/nginx 的 413 往往是 HTML，不能直接 response.json()
        const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
        const data = isJson
            ? ((await response.json()) as {
                  dxf?: string;
                  bytes?: number;
                  message?: string;
                  code?: string;
                  requestId?: string;
              })
            : null;

        if (!response.ok) {
            const fallback =
                response.status === 413
                    ? "DWG 文件超过服务端大小限制"
                    : `DWG 导入失败（HTTP ${response.status}）`;
            const error = new Error(data?.message || fallback) as Error & {
                status?: number;
                code?: string;
                requestId?: string;
            };
            error.status = response.status;
            error.code = data?.code;
            error.requestId = data?.requestId;
            throw error;
        }

        if (!data || typeof data.dxf !== "string") {
            throw new Error("DWG 转换服务返回了无法识别的结果");
        }
        return { dxf: data.dxf, bytes: data.bytes ?? 0 };
    }

    async getProject(id: string) {
        return this.request<{ project: any }>(`/projects/${id}`);
    }

    async createProject(
        name: string,
        description?: string,
        thumbnail?: string,
        options?: Pick<SyncRequestOptions, "idempotencyKey"> & {
            designConventions?: DesignConventions | null;
        },
    ) {
        return this.request<{ project: any; duplicate?: boolean }>(`/projects`, {
            method: "POST",
            headers: options?.idempotencyKey
                ? { "Idempotency-Key": options.idempotencyKey }
                : undefined,
            body: JSON.stringify({
                name,
                description,
                thumbnail,
                designConventions: options?.designConventions,
            }),
        });
    }

    async updateProject(
        id: string,
        data: {
            name?: string;
            description?: string;
            thumbnail?: string;
            designConventions?: DesignConventions | null;
            baseUpdatedAt?: string;
        },
        options?: Pick<SyncRequestOptions, "idempotencyKey" | "baseUpdatedAt">,
    ) {
        const baseUpdatedAt = options?.baseUpdatedAt ?? data.baseUpdatedAt;
        return this.request<{
            project: any;
            duplicate?: boolean;
            conflict?: boolean;
            serverUpdatedAt?: string;
        }>(`/projects/${id}`, {
            method: "PUT",
            headers: options?.idempotencyKey
                ? { "Idempotency-Key": options.idempotencyKey }
                : undefined,
            body: JSON.stringify({ ...data, baseUpdatedAt }),
        });
    }

    async deleteProject(id: string, options?: Pick<SyncRequestOptions, "idempotencyKey">) {
        return this.request(`/projects/${id}`, {
            method: "DELETE",
            headers: options?.idempotencyKey
                ? { "Idempotency-Key": options.idempotencyKey }
                : undefined,
        });
    }

    async openProject(id: string) {
        return this.request(`/projects/${id}/open`, {
            method: "POST",
        });
    }

    async saveProjectElements(id: string, elements: any[], options?: SyncRequestOptions) {
        return this.request<SaveElementsResponse>(`/projects/${id}/elements`, {
            method: "POST",
            headers: options?.idempotencyKey
                ? { "Idempotency-Key": options.idempotencyKey }
                : undefined,
            body: JSON.stringify({
                elements,
                baseUpdatedAt: options?.baseUpdatedAt,
            }),
        });
    }

    async listProjectVersions(projectId: string, options?: { limit?: number; before?: number }) {
        const params = new URLSearchParams();
        if (options?.limit) params.set("limit", String(options.limit));
        if (options?.before) params.set("before", String(options.before));
        const query = params.toString();
        return this.request<{
            versions: ProjectVersionSummary[];
            hasMore: boolean;
        }>(`/projects/${projectId}/versions${query ? `?${query}` : ""}`);
    }

    async createProjectVersion(
        projectId: string,
        snapshotData: ProjectVersion["snapshotData"],
        commitMessage?: string,
    ) {
        return this.request<{ version: ProjectVersionSummary }>(`/projects/${projectId}/versions`, {
            method: "POST",
            body: JSON.stringify({ snapshotData, commitMessage }),
        });
    }

    async getProjectVersion(projectId: string, versionId: string) {
        return this.request<{ version: ProjectVersion }>(
            `/projects/${projectId}/versions/${versionId}`,
        );
    }

    async getLLMModels(): Promise<{ models: LLMModel[] }> {
        return this.request<{ models: LLMModel[] }>(`/llm`);
    }

    async createLLMModel(data: LLMModelInput): Promise<{ model: LLMModel }> {
        return this.request<{ model: LLMModel }>(`/llm`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    }

    async updateLLMModel(id: string, data: Partial<LLMModelInput>): Promise<{ model: LLMModel }> {
        return this.request<{ model: LLMModel }>(`/llm/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        });
    }

    /** 设为默认是全局唯一态，服务端用事务清掉其它默认标记 */
    async setDefaultLLMModel(id: string): Promise<{ model: LLMModel }> {
        return this.request<{ model: LLMModel }>(`/llm/${id}/default`, {
            method: "POST",
        });
    }

    /** 连接测试失败也返回 200，用 ok 字段区分，避免 UI 把它当网络错误 */
    async testLLMModel(id: string): Promise<{
        ok: boolean;
        latencyMs?: number;
        code?: string;
        message?: string;
        retryable?: boolean;
    }> {
        return this.request(`/llm/${id}/test`, { method: "POST" });
    }

    async getAIUsage(days = 30): Promise<AIUsageSummary> {
        return this.request<AIUsageSummary>(`/llm/usage?days=${days}`);
    }

    async deleteLLMModel(id: string) {
        return this.request(`/llm/${id}`, {
            method: "DELETE",
        });
    }

    async getAssistants(): Promise<{ assistants: Assistant[] }> {
        return this.request<{ assistants: Assistant[] }>(`/assistants`);
    }

    async createAssistant(data: AssistantInput): Promise<{ assistant: Assistant }> {
        return this.request<{ assistant: Assistant }>(`/assistants`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    }

    async updateAssistant(
        id: string,
        data: Partial<AssistantInput>,
    ): Promise<{ assistant: Assistant }> {
        return this.request<{ assistant: Assistant }>(`/assistants/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        });
    }

    async updateAssistantSkills(
        id: string,
        skills: Array<{ skillId: string; weight?: number }>,
    ): Promise<{ assistant: Assistant }> {
        return this.request<{ assistant: Assistant }>(`/assistants/${id}/skills`, {
            method: "PUT",
            body: JSON.stringify({ skills }),
        });
    }

    async deleteAssistant(id: string) {
        return this.request(`/assistants/${id}`, {
            method: "DELETE",
        });
    }

    // --- 技能 ---

    async getSkills(): Promise<{ skills: AiSkill[] }> {
        return this.request<{ skills: AiSkill[] }>(`/skills`);
    }

    /** 输入过程中解析候选技能；与回合内的实际激活共用后端评分规则 */
    async resolveSkills(data: SkillResolveInput): Promise<{ matchedSkills: AiSkillCandidate[] }> {
        return this.request<{ matchedSkills: AiSkillCandidate[] }>(`/skills/resolve`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    }

    async getSkillStats(): Promise<{
        days: number;
        rated: number;
        decided: number;
        skills: Array<{
            code: string;
            up: number;
            down: number;
            total: number;
            helpfulRate: number;
            applied: number;
            discarded: number;
            adoptionRate: number;
        }>;
    }> {
        return this.request(`/skills/stats`);
    }

    async createSkill(data: SkillInput): Promise<{ skill: AiSkill }> {
        return this.request<{ skill: AiSkill }>(`/skills`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    }

    async updateSkill(id: string, data: Partial<SkillInput>): Promise<{ skill: AiSkill }> {
        return this.request<{ skill: AiSkill }>(`/skills/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        });
    }

    async setSkillEnabled(id: string, isEnabled: boolean): Promise<{ skill: AiSkill }> {
        return this.request<{ skill: AiSkill }>(`/skills/${id}/enabled`, {
            method: "PATCH",
            body: JSON.stringify({ isEnabled }),
        });
    }

    async cloneSkill(id: string): Promise<{ skill: AiSkill }> {
        return this.request<{ skill: AiSkill }>(`/skills/${id}/clone`, {
            method: "POST",
        });
    }

    async deleteSkill(id: string) {
        return this.request(`/skills/${id}`, { method: "DELETE" });
    }

    // --- 会话与历史 ---

    async getChatSessions(
        projectId: string,
        options: { limit?: number; before?: string } = {},
    ): Promise<{
        sessions: ChatSessionInfo[];
        hasMore: boolean;
        nextCursor: string | null;
    }> {
        const params = new URLSearchParams();
        if (options.limit) params.set("limit", String(options.limit));
        if (options.before) params.set("before", options.before);
        const query = params.toString();
        return this.request(`/chat/sessions/${projectId}${query ? `?${query}` : ""}`);
    }

    async getActiveChatSession(projectId: string): Promise<{ session: ChatSessionInfo | null }> {
        return this.request<{ session: ChatSessionInfo | null }>(
            `/chat/sessions/${projectId}/active`,
        );
    }

    async createChatSession(data: {
        projectId: string;
        title?: string;
        assistantId?: string | null;
        modelId?: string | null;
    }): Promise<{ session: ChatSessionInfo }> {
        return this.request<{ session: ChatSessionInfo }>(`/chat/sessions`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    }

    /** null 表示清除绑定，未提供的字段不动 */
    async patchChatSession(
        sessionId: string,
        data: { title?: string; assistantId?: string | null; modelId?: string | null },
    ): Promise<{ session: ChatSessionInfo }> {
        return this.request<{ session: ChatSessionInfo }>(`/chat/sessions/${sessionId}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        });
    }

    async getChatMessages(
        sessionId: string,
        options: { limit?: number; before?: string } = {},
    ): Promise<{
        messages: ChatLogMessage[];
        hasMore: boolean;
        nextCursor: string | null;
        sessionId: string;
        projectId: string;
    }> {
        const params = new URLSearchParams();
        if (options.limit) params.set("limit", String(options.limit));
        if (options.before) params.set("before", options.before);
        const query = params.toString();
        return this.request(`/chat/sessions/${sessionId}/messages${query ? `?${query}` : ""}`);
    }

    async compactChatSession(
        sessionId: string,
    ): Promise<{ summary: string; summaryChars: number; droppedCount: number }> {
        return this.request(`/chat/sessions/${sessionId}/compact`, { method: "POST" });
    }

    /** 记录用户最终应用还是丢弃了这批 AI 动作，便于统计真实采纳率 */
    async recordTurnOutcome(data: {
        sessionId: string;
        turnId: string;
        outcome: "applied" | "discarded";
        reason?: string;
        changedIds?: string[];
        skillCodes?: string[];
    }) {
        const result = await this.request<{ recorded: boolean }>(
            `/chat/turns/${encodeURIComponent(data.turnId)}/outcome`,
            {
                method: "POST",
                body: JSON.stringify(data),
            },
        );
        markSkillStatsDirty();
        return result;
    }

    /** 回答反馈：up/down + 原因 + 当轮激活的技能，用于技能有用率统计 */
    async sendChatFeedback(data: {
        sessionId: string;
        turnId: string;
        rating: "up" | "down";
        reason?: string;
        skillCodes?: string[];
    }) {
        const result = await this.request<{ recorded: boolean; messageId?: string }>(
            `/chat/turns/${encodeURIComponent(data.turnId)}/feedback`,
            {
                method: "POST",
                body: JSON.stringify(data),
            },
        );
        markSkillStatsDirty();
        return result;
    }

    async deleteChatSession(sessionId: string) {
        return this.request(`/chat/sessions/${sessionId}`, {
            method: "DELETE",
        });
    }

    /** 服务端 JSON 错误体里的字符串字段，缺失或类型不符时返回 undefined */
    private static pick(payload: Record<string, unknown>, key: string): string | undefined {
        const value = payload[key];
        return typeof value === "string" ? value : undefined;
    }

    /**
     * Agent 单回合：发送请求体并把 SSE 事件折叠成回合状态。
     * 多轮工具循环由 hooks/useAIChat 驱动，这里只负责一次 HTTP 往返。
     */
    async runAgentTurn(
        request: AgentChatRequest,
        handlers: {
            onEvent?: (event: AgentEvent) => void;
            onContent?: (text: string) => void;
            signal?: AbortSignal;
        } = {},
    ): Promise<AgentTurnState> {
        const response = await fetch(`${API_BASE_URL}/llm/chat`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(request),
            signal: handlers.signal,
        });

        if (!response.ok) {
            let payload: Record<string, unknown> = {};
            try {
                const parsed: unknown = await response.json();
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    payload = parsed as Record<string, unknown>;
                }
            } catch {
                // 网关可能返回非 JSON（例如 HTML 错误页），此时只按状态码归一化
            }
            const retryable = payload.retryable;
            throw new AIRequestError(
                ApiService.pick(payload, "code"),
                ApiService.pick(payload, "message") ?? ApiService.pick(payload, "error"),
                {
                    status: response.status,
                    requestId: ApiService.pick(payload, "requestId"),
                    retryable: typeof retryable === "boolean" ? retryable : undefined,
                },
            );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new AIRequestError("PROVIDER_NO_BODY", null);

        const decoder = new TextDecoder();
        let state = initialAgentTurn();
        let buffer = "";

        const consume = (line: string) => {
            const event = parseSseLine(line);
            if (!event) return;
            state = reduceAgentTurn(state, event);
            handlers.onEvent?.(event);
            if (event.kind === "content") handlers.onContent?.(event.content);
            if (event.kind === "error") {
                throw new AIRequestError(event.error.code, event.error.error, {
                    requestId: event.error.requestId,
                    retryable: event.error.retryable,
                });
            }
        };

        for (;;) {
            if (handlers.signal?.aborted) {
                void reader.cancel();
                break;
            }
            const { done, value } = await reader.read();
            if (done) break;

            // SSE 事件可能跨网络分包，按行缓冲避免丢弃半个 JSON
            buffer += decoder.decode(value, { stream: true });
            const { completed, rest } = splitSseLines(buffer);
            buffer = rest;
            for (const line of completed) consume(line);
        }

        if (buffer.trim()) consume(buffer.trim());

        return state;
    }
}

export const apiService = new ApiService();
