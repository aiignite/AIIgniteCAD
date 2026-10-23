/**
 * 有状态 API mock：拦截浏览器内的 /api 请求并维护项目与幂等键，
 * 让冒烟测试可以在没有数据库和后端进程的情况下验证完整保存/恢复链路。
 */

import type { Page, Route } from "@playwright/test";
import type {
    AiSkill,
    Assistant,
    CADElement,
    DesignConventions,
    LLMModel,
} from "../../../types";

export interface MockProject {
    id: string;
    name: string;
    description?: string;
    thumbnail?: string;
    updatedAt: string;
    lastOpenedAt?: string;
    elements: CADElement[];
    designConventions?: DesignConventions | null;
}

export interface MockVersion {
    id: string;
    projectId: string;
    versionNumber: number;
    snapshotData: { elements: CADElement[] };
    elementCount: number;
    commitMessage?: string;
    createdBy: string;
    createdAt: string;
}

export interface ApiMockState {
    projects: Map<string, MockProject>;
    versions: Map<string, MockVersion[]>;
    idempotency: Map<string, string>;
    elementSaves: number;
    loginAttempts: number;
    duplicateSaves: number;
    models: LLMModel[];
    assistants: Assistant[];
    skills: AiSkill[];
    /** 记录每次「设为默认模型」请求命中的 id，用于确认偏好真的写到了服务端 */
    defaultModelCalls: string[];
}

export interface ApiMock {
    state: ApiMockState;
}

export const TEST_USER = {
    id: "user-e2e",
    username: "E2E Tester",
    email: "tester@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
};

/** 设置页的 AI 分区需要真实行才能验证搜索与「设为默认」链路 */
const seedModels = (): LLMModel[] => [
    {
        id: "model-default",
        name: "本地 Qwen",
        provider: "Ollama",
        modelId: "qwen2.5-coder",
        isActive: true,
        isDefault: true,
    },
    {
        id: "model-cloud",
        name: "云端 GPT",
        provider: "OpenAI",
        modelId: "gpt-4o-mini",
        isActive: true,
        isDefault: false,
    },
];

const seedAssistants = (): Assistant[] => [
    {
        id: "assistant-drafter",
        name: "绘图助手",
        icon: "design_services",
        description: "按命令画图并检查规范",
        color: "#137fec",
        category: "绘图",
        llmModelId: "model-default",
    },
];

const seedSkills = (): AiSkill[] => [
    {
        id: "skill-gear",
        code: "GEAR_DESIGN",
        name: "齿轮设计",
        description: "按模数与齿数生成齿轮轮廓",
        category: "参数化",
        promptTemplate: "生成齿轮",
        toolNames: ["generate_gear"],
        selectionTypes: [],
        keywords: ["齿轮", "gear"],
        steps: [{ title: "确认模数", tool: "generate_gear" }],
        checks: ["齿数大于 8"],
        examples: ["做一个 20 齿齿轮"],
        requiredContext: [],
        negativeKeywords: [],
        version: 1,
        priority: 10,
        isEnabled: true,
        isSystem: false,
        userId: TEST_USER.id,
        updatedAt: "2026-01-01T00:00:00.000Z",
    },
];

/** 块库接口返回的固定符号：200×100 门洞，基准点为原点 */
export const TEST_BLOCK = {
    id: "block-door",
    name: "标准门洞",
    description: "200×100 门洞符号",
    basePoint: { x: 0, y: 0 },
    elements: [
        {
            id: "door-rect",
            type: "RECTANGLE" as const,
            start: { x: 0, y: 0 },
            width: 200,
            height: 100,
            layer: "0",
            color: "#e6edf3",
        },
        {
            id: "door-line",
            type: "LINE" as const,
            start: { x: 0, y: 50 },
            end: { x: 200, y: 50 },
            layer: "0",
            color: "#e6edf3",
        },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

/** DWG 导入接口返回的最小 DXF：一条世界坐标 (0,0)-(100,0) 的直线 */
export const DWG_IMPORT_DXF = [
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "100", "21", "0",
    "0", "ENDSEC", "0", "EOF",
].join("\n");

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
    "Access-Control-Max-Age": "600",
};

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify(body),
    });

const readBody = <T>(route: Route): T => {
    try {
        return (route.request().postDataJSON() ?? {}) as T;
    } catch {
        return {} as T;
    }
};

const toVersionMetadata = (version: MockVersion) => ({
    id: version.id,
    projectId: version.projectId,
    versionNumber: version.versionNumber,
    elementCount: version.elementCount,
    commitMessage: version.commitMessage,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
});

const toElementRecord = (element: CADElement, index: number) => ({
    id: `server-element-${index}`,
    elementType: element.type,
    geometryData: element,
    properties: { color: element.color, layer: element.layer },
});

export async function installApiMock(page: Page): Promise<ApiMock> {
    const state: ApiMockState = {
        projects: new Map(),
        versions: new Map(),
        idempotency: new Map(),
        elementSaves: 0,
        loginAttempts: 0,
        duplicateSaves: 0,
        models: seedModels(),
        assistants: seedAssistants(),
        skills: seedSkills(),
        defaultModelCalls: [],
    };
    let projectSeq = 0;
    let versionSeq = 0;

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const method = request.method();

        if (method === "OPTIONS") {
            await route.fulfill({ status: 204, headers: CORS_HEADERS });
            return;
        }

        const { pathname } = new URL(request.url());
        const path = pathname.replace(/^\/api/, "");
        const idempotencyKey = request.headers()["idempotency-key"];

        if (path === "/auth/login" && method === "POST") {
            state.loginAttempts += 1;
            await json(route, 200, { token: "e2e-token", user: TEST_USER });
            return;
        }

        if (path === "/auth/register" && method === "POST") {
            await json(route, 201, { token: "e2e-token", user: TEST_USER });
            return;
        }

        if (path === "/auth/me" && method === "GET") {
            await json(route, 200, { user: TEST_USER });
            return;
        }

        if (path === "/auth/logout" && method === "POST") {
            await json(route, 200, { message: "Logged out" });
            return;
        }

        if (path === "/blocks/tree" && method === "GET") {
            await json(route, 200, { rootBlocks: [TEST_BLOCK], categories: [] });
            return;
        }

        if (path === "/import/dwg" && method === "POST") {
            await json(route, 200, { dxf: DWG_IMPORT_DXF, bytes: 16 });
            return;
        }

        if (path === "/projects" && method === "GET") {
            const projects = [...state.projects.values()].map((project) => ({
                id: project.id,
                name: project.name,
                description: project.description,
                lastModified: project.updatedAt,
                lastOpened: project.lastOpenedAt,
                thumbnail: project.thumbnail,
                elementCount: project.elements.length,
            }));
            await json(route, 200, { projects, total: projects.length });
            return;
        }

        if (path === "/projects" && method === "POST") {
            const existingId = idempotencyKey ? state.idempotency.get(idempotencyKey) : undefined;
            if (existingId) {
                await json(route, 200, {
                    duplicate: true,
                    project: { id: existingId },
                });
                return;
            }

            const body = readBody<{
                name?: string;
                description?: string;
                thumbnail?: string;
                designConventions?: DesignConventions | null;
            }>(route);
            projectSeq += 1;
            const project: MockProject = {
                id: `project-${projectSeq}`,
                name: body.name || "Untitled Drawing",
                description: body.description,
                thumbnail: body.thumbnail,
                designConventions: body.designConventions ?? null,
                updatedAt: new Date().toISOString(),
                elements: [],
            };
            state.projects.set(project.id, project);
            if (idempotencyKey) state.idempotency.set(idempotencyKey, project.id);
            await json(route, 201, { project });
            return;
        }

        const versionsMatch = path.match(/^\/projects\/([^/]+)\/versions$/);
        if (versionsMatch && method === "GET") {
            const { searchParams } = new URL(request.url());
            const limit = Number.parseInt(searchParams.get("limit") || "30", 10);
            const before = Number.parseInt(searchParams.get("before") || "", 10);
            const all = [...(state.versions.get(versionsMatch[1]) ?? [])].sort(
                (a, b) => b.versionNumber - a.versionNumber,
            );
            const filtered = Number.isFinite(before)
                ? all.filter((version) => version.versionNumber < before)
                : all;
            const page = filtered.slice(0, limit);
            await json(route, 200, {
                versions: page.map(toVersionMetadata),
                hasMore: filtered.length > limit,
            });
            return;
        }

        if (versionsMatch && method === "POST") {
            const body = readBody<{
                snapshotData?: { elements?: CADElement[] };
                commitMessage?: string;
            }>(route);
            const elements = body.snapshotData?.elements;
            if (!Array.isArray(elements)) {
                await json(route, 400, { message: "snapshotData.elements must be an array" });
                return;
            }
            versionSeq += 1;
            const list = state.versions.get(versionsMatch[1]) ?? [];
            const version: MockVersion = {
                id: `version-${versionSeq}`,
                projectId: versionsMatch[1],
                versionNumber: list.length + 1,
                snapshotData: { elements },
                elementCount: elements.length,
                commitMessage: body.commitMessage,
                createdBy: TEST_USER.id,
                createdAt: new Date().toISOString(),
            };
            state.versions.set(versionsMatch[1], [...list, version]);
            await json(route, 201, { version: toVersionMetadata(version) });
            return;
        }

        const versionDetailMatch = path.match(/^\/projects\/([^/]+)\/versions\/([^/]+)$/);
        if (versionDetailMatch && method === "GET") {
            const version = (state.versions.get(versionDetailMatch[1]) ?? []).find(
                (item) => item.id === versionDetailMatch[2],
            );
            if (!version) {
                await json(route, 404, { message: "Version not found" });
                return;
            }
            await json(route, 200, { version });
            return;
        }

        const openMatch = path.match(/^\/projects\/([^/]+)\/open$/);
        if (openMatch && method === "POST") {
            const project = state.projects.get(openMatch[1]);
            if (!project) {
                await json(route, 404, { message: "Project not found" });
                return;
            }
            project.lastOpenedAt = new Date().toISOString();
            await json(route, 200, { message: "Project opened" });
            return;
        }

        const elementsMatch = path.match(/^\/projects\/([^/]+)\/elements$/);
        if (elementsMatch && method === "POST") {
            const project = state.projects.get(elementsMatch[1]);
            if (!project) {
                await json(route, 404, { message: "Project not found" });
                return;
            }

            if (idempotencyKey && state.idempotency.get(idempotencyKey) === project.id) {
                state.duplicateSaves += 1;
                await json(route, 200, {
                    duplicate: true,
                    message: "Elements save already processed",
                    conflict: false,
                    updatedAt: project.updatedAt,
                });
                return;
            }

            const body = readBody<{ elements?: CADElement[] }>(route);
            const elements = Array.isArray(body.elements) ? body.elements : [];
            project.elements = elements;
            project.updatedAt = new Date().toISOString();
            state.elementSaves += 1;
            if (idempotencyKey) state.idempotency.set(idempotencyKey, project.id);
            await json(route, 200, {
                message: "Elements saved successfully",
                count: elements.length,
                conflict: false,
                updatedAt: project.updatedAt,
            });
            return;
        }

        const detailMatch = path.match(/^\/projects\/([^/]+)$/);
        if (detailMatch && method === "GET") {
            const project = state.projects.get(detailMatch[1]);
            if (!project) {
                await json(route, 404, { message: "Project not found" });
                return;
            }
            await json(route, 200, {
                project: {
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    thumbnail: project.thumbnail,
                    designConventions: project.designConventions ?? null,
                    updatedAt: project.updatedAt,
                    lastOpenedAt: project.lastOpenedAt,
                    layers: [],
                    drawingSettings: null,
                    blockReferences: [],
                    elements: project.elements.map(toElementRecord),
                },
            });
            return;
        }

        if (detailMatch && method === "PUT") {
            const project = state.projects.get(detailMatch[1]);
            if (!project) {
                await json(route, 404, { message: "Project not found" });
                return;
            }
            const body = readBody<{
                name?: string;
                description?: string;
                thumbnail?: string;
                designConventions?: DesignConventions | null;
            }>(route);
            if (body.name !== undefined) project.name = body.name;
            if (body.description !== undefined) project.description = body.description;
            if (body.thumbnail !== undefined) project.thumbnail = body.thumbnail;
            if (body.designConventions !== undefined) {
                project.designConventions = body.designConventions;
            }
            project.updatedAt = new Date().toISOString();
            await json(route, 200, { project });
            return;
        }

        if (detailMatch && method === "DELETE") {
            state.projects.delete(detailMatch[1]);
            await json(route, 200, { message: "Project deleted" });
            return;
        }

        // AI 注册表：设置页的模型 / 助手 / 技能分区按真实行渲染
        if (path === "/llm" && method === "GET") {
            await json(route, 200, { models: state.models });
            return;
        }

        const defaultModelMatch = path.match(/^\/llm\/([^/]+)\/default$/);
        if (defaultModelMatch && method === "POST") {
            state.models = state.models.map((model) => ({
                ...model,
                isDefault: model.id === defaultModelMatch[1],
            }));
            state.defaultModelCalls.push(defaultModelMatch[1]);
            await json(route, 200, {
                model: state.models.find((model) => model.id === defaultModelMatch[1]),
            });
            return;
        }

        if (path === "/assistants" && method === "GET") {
            await json(route, 200, { assistants: state.assistants });
            return;
        }

        if (path === "/skills" && method === "GET") {
            await json(route, 200, { skills: state.skills });
            return;
        }

        // 模型面板的用量条带真实结构，缺字段会让面板读到 undefined.length
        if (path === "/llm/usage" && method === "GET") {
            await json(route, 200, {
                days: 30,
                calls: 12,
                failures: 1,
                failureRate: 1 / 12,
                promptTokens: 4200,
                completionTokens: 1800,
                costUsd: 0.03,
                avgLatencyMs: 940,
                byProvider: [{ provider: "Ollama", calls: 12, failures: 1 }],
            });
            return;
        }

        // 其余辅助接口（blocks、会话、用量等）返回空集合
        await json(route, 200, {
            blocks: [],
            categories: [],
            assistants: [],
            models: [],
            skills: [],
            sessions: [],
            messages: [],
        });
    });

    return { state };
}
