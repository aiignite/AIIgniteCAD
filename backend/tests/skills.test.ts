/**
 * skills.test.ts — 技能管理接口
 *
 * 覆盖序列化、校验、code 冲突、系统技能只读、他人技能不可探测、克隆与删除级联。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock, ensureMock } = vi.hoisted(() => {
  const createModelMock = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
  });

  return {
    prismaMock: {
      user: createModelMock(),
      aiSkill: createModelMock(),
      assistantSkill: createModelMock(),
      chatMessage: createModelMock(),
      $transaction: vi.fn(),
    },
    ensureMock: { ensureSystemSkills: vi.fn() },
  };
});

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock("../src/services/aiEngine/skills/skillService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/aiEngine/skills/skillService")>();
  return { ...actual, ensureSystemSkills: ensureMock.ensureSystemSkills };
});

import app from "../src/app";
import { generateToken } from "../src/middleware/auth";

const token = generateToken({ id: "user-1", email: "alice@example.com", username: "alice" });

const authed = (method: "get" | "post" | "put" | "patch" | "delete", url: string) =>
  request(app)[method](url).set("Authorization", `Bearer ${token}`);

const skillRow = (overrides: Record<string, unknown> = {}) => ({
  id: "skill-1",
  code: "my_skill",
  name: "我的技能",
  description: "",
  category: "Custom",
  promptTemplate: "优先使用阵列与偏移完成重复结构。",
  toolNames: ["array_elements", "offset_elements"],
  keywords: ["阵列"],
  selectionTypes: [],
  steps: [{ title: "确定对象", detail: "先查询再阵列", tool: "query_elements" }],
  checks: ["副本数量正确"],
  examples: ["把这个圆阵列 3 行 4 列"],
  requiredContext: ["selection"],
  negativeKeywords: ["三维"],
  version: 2,
  priority: 50,
  isEnabled: true,
  isSystem: false,
  userId: "user-1",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("技能管理接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    ensureMock.ensureSystemSkills.mockResolvedValue(0);
    prismaMock.$transaction.mockResolvedValue([]);
  });

  it("列表先确保内置技能已装载，再返回扁平结构", async () => {
    prismaMock.aiSkill.findMany.mockResolvedValue([
      skillRow({ isSystem: true, userId: null, code: "cad_drafting_basic" }),
      skillRow(),
    ]);

    const res = await authed("get", "/api/skills");

    expect(res.status).toBe(200);
    expect(ensureMock.ensureSystemSkills).toHaveBeenCalledTimes(1);
    expect(res.body.skills[0].isSystem).toBe(true);
    expect(res.body.skills[1]).toMatchObject({
      id: "skill-1",
      toolNames: ["array_elements", "offset_elements"],
      keywords: ["阵列"],
      steps: [{ title: "确定对象", detail: "先查询再阵列", tool: "query_elements" }],
      checks: ["副本数量正确"],
      examples: ["把这个圆阵列 3 行 4 列"],
      requiredContext: ["selection"],
      negativeKeywords: ["三维"],
      version: 2,
      isSystem: false,
    });
  });

  it("创建时生成用户技能 code，缺省 priority 与 isEnabled", async () => {
    prismaMock.aiSkill.findUnique.mockResolvedValue(null);
    prismaMock.aiSkill.create.mockImplementation(async ({ data }: any) => ({
      ...skillRow(data),
      ...data,
      id: "skill-2",
    }));

    const res = await authed("post", "/api/skills").send({
      name: "曲线助手",
      promptTemplate: "绘制曲线时先给出采样点数。",
      toolNames: ["draw_polyline"],
      keywords: ["曲线", "样条"],
    });

    expect(res.status).toBe(201);
    const data = prismaMock.aiSkill.create.mock.calls[0][0].data;
    expect(data.userId).toBe("user-1");
    expect(data.isSystem).toBe(false);
    expect(data.code).toMatch(/^user-user-1-/);
    expect(data.priority).toBe(50);
    expect(data.isEnabled).toBe(true);
    expect(data.toolNames).toEqual(["draw_polyline"]);
  });

  it("拒绝非法 code、超长提示词与未知工具", async () => {
    const badCode = await authed("post", "/api/skills").send({
      name: "x",
      code: "BAD CODE",
      promptTemplate: "abc",
    });
    expect(badCode.status).toBe(400);
    expect(badCode.body.message).toContain("code must match");

    const longPrompt = await authed("post", "/api/skills").send({
      name: "x",
      promptTemplate: "a".repeat(4001),
    });
    expect(longPrompt.status).toBe(400);

    const badTool = await authed("post", "/api/skills").send({
      name: "x",
      promptTemplate: "abc",
      toolNames: ["drop_database"],
    });
    expect(badTool.status).toBe(400);
    expect(badTool.body.message).toContain("drop_database");

    const emptyPrompt = await authed("post", "/api/skills").send({ name: "x", promptTemplate: "  " });
    expect(emptyPrompt.status).toBe(400);
    expect(emptyPrompt.body.message).toBe("promptTemplate is required");
  });

  it("步骤引用未知工具、选择类型非法时拒绝写入", async () => {
    prismaMock.aiSkill.findUnique.mockResolvedValue(null);

    const badStepTool = await authed("post", "/api/skills").send({
      name: "x",
      promptTemplate: "abc",
      steps: [{ title: "先画线", tool: "draw_everything" }],
    });
    expect(badStepTool.status).toBe(400);
    expect(badStepTool.body.message).toContain("draw_everything");

    const badSelectionTypes = await authed("post", "/api/skills").send({
      name: "x",
      promptTemplate: "abc",
      selectionTypes: [""],
    });
    expect(badSelectionTypes.status).toBe(400);
    expect(badSelectionTypes.body.message).toContain("selectionTypes");

    expect(prismaMock.aiSkill.create).not.toHaveBeenCalled();
  });

  it("code 已存在时返回 409", async () => {
    prismaMock.aiSkill.findUnique.mockResolvedValue(skillRow({ code: "my_skill" }));

    const res = await authed("post", "/api/skills").send({
      name: "x",
      code: "my_skill",
      promptTemplate: "abc",
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CODE_TAKEN");
    expect(prismaMock.aiSkill.create).not.toHaveBeenCalled();
  });

  it("系统技能只读，他人技能按不存在处理", async () => {
    prismaMock.aiSkill.findFirst.mockResolvedValue(skillRow({ isSystem: true, userId: null }));
    const system = await authed("put", "/api/skills/skill-1").send({
      name: "改",
      promptTemplate: "abc",
    });
    expect(system.status).toBe(403);
    expect(system.body.code).toBe("READ_ONLY");

    prismaMock.aiSkill.findFirst.mockResolvedValue(skillRow({ userId: "user-2" }));
    const foreign = await authed("put", "/api/skills/skill-1").send({
      name: "改",
      promptTemplate: "abc",
    });
    expect(foreign.status).toBe(404);
  });

  it("创建时持久化 playbook 字段并拒绝非法上下文信号", async () => {
    prismaMock.aiSkill.findUnique.mockResolvedValue(null);
    prismaMock.aiSkill.create.mockImplementation(async ({ data }: any) => ({
      ...skillRow(data),
      ...data,
      id: "skill-2",
      version: 1,
    }));

    const res = await authed("post", "/api/skills").send({
      name: "标注助手",
      promptTemplate: "先测量再标注。",
      steps: [{ title: "测量", detail: "读取真实坐标", tool: "measure_geometry" }],
      checks: ["标注值与实际距离一致"],
      examples: ["给这条线加尺寸"],
      requiredContext: ["selection", "dimensions"],
      negativeKeywords: ["三维"],
    });

    expect(res.status).toBe(201);
    const data = prismaMock.aiSkill.create.mock.calls[0][0].data;
    expect(data.steps).toEqual([
      { title: "测量", detail: "读取真实坐标", tool: "measure_geometry" },
    ]);
    expect(data.requiredContext).toEqual(["selection", "dimensions"]);
    expect(res.body.skill.steps).toHaveLength(1);
    expect(res.body.skill.version).toBe(1);

    const invalid = await authed("post", "/api/skills").send({
      name: "坏信号",
      promptTemplate: "abc",
      requiredContext: ["selection", "weather"],
    });
    expect(invalid.status).toBe(400);
  });

  it("更新自建技能时保留未提交的工具列表", async () => {
    prismaMock.aiSkill.findFirst.mockResolvedValue(skillRow());
    prismaMock.aiSkill.update.mockImplementation(async ({ data }: any) => ({
      ...skillRow(),
      ...data,
    }));

    const res = await authed("put", "/api/skills/skill-1").send({
      name: "改名",
      promptTemplate: "新的提示词",
      priority: 80,
    });

    expect(res.status).toBe(200);
    const data = prismaMock.aiSkill.update.mock.calls[0][0].data;
    expect(data.promptTemplate).toBe("新的提示词");
    expect(data.priority).toBe(80);
    expect(data).not.toHaveProperty("toolNames");
    expect(res.body.skill.toolNames).toEqual(["array_elements", "offset_elements"]);
  });

  it("启停开关只接受布尔值且沿用同一套权限校验", async () => {
    prismaMock.aiSkill.findFirst.mockResolvedValue(skillRow());
    prismaMock.aiSkill.update.mockResolvedValue(skillRow({ isEnabled: false }));

    const bad = await authed("patch", "/api/skills/skill-1/enabled").send({ isEnabled: "yes" });
    expect(bad.status).toBe(400);

    const ok = await authed("patch", "/api/skills/skill-1/enabled").send({ isEnabled: false });
    expect(ok.status).toBe(200);
    expect(ok.body.skill.isEnabled).toBe(false);
  });

  it("克隆系统技能得到可编辑副本并避开 code 冲突", async () => {
    prismaMock.aiSkill.findFirst.mockResolvedValue(
      skillRow({ isSystem: true, userId: null, code: "cad_drafting_basic" }),
    );
    prismaMock.aiSkill.findUnique.mockResolvedValue(null);
    prismaMock.aiSkill.create.mockImplementation(async ({ data }: any) => ({
      ...skillRow(data),
      ...data,
    }));

    const res = await authed("post", "/api/skills/skill-1/clone");

    expect(res.status).toBe(201);
    const data = prismaMock.aiSkill.create.mock.calls[0][0].data;
    expect(data.code).toBe("cad_drafting_basic-copy");
    expect(data.isSystem).toBe(false);
    expect(data.userId).toBe("user-1");
    expect(res.body.skill.name).toBe("我的技能 副本");
  });

  it("克隆不可见技能返回 404", async () => {
    prismaMock.aiSkill.findFirst.mockResolvedValue(null);
    const res = await authed("post", "/api/skills/skill-1/clone");
    expect(res.status).toBe(404);
  });

  it("删除自建技能同时清理助手绑定", async () => {
    prismaMock.aiSkill.findFirst.mockResolvedValue(skillRow());

    const res = await authed("delete", "/api/skills/skill-1");

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.assistantSkill.deleteMany).toHaveBeenCalledWith({
      where: { skillId: "skill-1" },
    });
  });

  it("未鉴权请求无法访问技能", async () => {
    const res = await request(app).get("/api/skills");
    expect(res.status).toBe(401);
  });

  it("有用率统计按技能聚合上下评价，未评价消息不计入", async () => {
    prismaMock.chatMessage.findMany
      .mockResolvedValueOnce([
        {
          metadata: {
            feedback: { rating: "up", at: "2026-01-01T00:00:00.000Z" },
            feedbackSkillCodes: ["mech-draft", "layout"],
          },
        },
        {
          metadata: {
            feedback: { rating: "down", reason: "不准确", at: "2026-01-01T00:00:00.000Z" },
            feedbackSkillCodes: ["mech-draft"],
          },
        },
        { metadata: { feedback: { rating: "up" }, feedbackSkillCodes: ["mech-draft"] } },
        { metadata: null },
        { metadata: { feedback: { rating: "maybe" }, feedbackSkillCodes: ["mech-draft"] } },
      ])
      .mockResolvedValueOnce([]);

    const res = await authed("get", "/api/skills/stats?days=7");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(res.body.rated).toBe(3);
    expect(res.body.decided).toBe(0);
    expect(res.body.skills[0]).toEqual({
      code: "mech-draft",
      up: 2,
      down: 1,
      total: 3,
      helpfulRate: 0.67,
      applied: 0,
      discarded: 0,
      adoptionRate: 0,
    });
    expect(res.body.skills[1]).toEqual({
      code: "layout",
      up: 1,
      down: 0,
      total: 1,
      helpfulRate: 1,
      applied: 0,
      discarded: 0,
      adoptionRate: 0,
    });
    const where = prismaMock.chatMessage.findMany.mock.calls[0][0].where;
    expect(where.senderType).toBe("ai");
    expect(where.session).toEqual({ userId: "user-1" });
  });

  it("统计同时汇总采纳与丢弃，得到真实采纳率", async () => {
    prismaMock.chatMessage.findMany
      .mockResolvedValueOnce([
        { metadata: { feedback: { rating: "up" }, feedbackSkillCodes: ["mech-draft"] } },
      ])
      .mockResolvedValueOnce([
        { metadata: { outcome: "applied", skillCodes: ["mech-draft"] } },
        { metadata: { outcome: "applied", skillCodes: ["mech-draft"] } },
        { metadata: { outcome: "discarded", skillCodes: ["mech-draft"] } },
        { metadata: { outcome: "discarded", skillCodes: ["other"] } },
        { metadata: { outcome: "applied" } },
        { metadata: null },
      ]);

    const res = await authed("get", "/api/skills/stats?days=30");

    expect(res.status).toBe(200);
    expect(res.body.decided).toBe(5);
    const draft = res.body.skills.find((row: { code: string }) => row.code === "mech-draft");
    expect(draft.applied).toBe(2);
    expect(draft.discarded).toBe(1);
    expect(draft.adoptionRate).toBe(0.67);
    const other = res.body.skills.find((row: { code: string }) => row.code === "other");
    expect(other.adoptionRate).toBe(0);
    const outcomeWhere = prismaMock.chatMessage.findMany.mock.calls[1][0].where;
    expect(outcomeWhere.senderType).toBe("user");
  });

  it("有用率统计的天数被夹在 1 到 365 之间", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue([]);

    const tooLarge = await authed("get", "/api/skills/stats?days=9999");
    expect(tooLarge.status).toBe(200);
    expect(tooLarge.body.days).toBe(365);

    const tooSmall = await authed("get", "/api/skills/stats?days=0");
    expect(tooSmall.body.days).toBe(1);

    const fallback = await authed("get", "/api/skills/stats?days=abc");
    expect(fallback.body.days).toBe(30);
    expect(fallback.body.skills).toEqual([]);
  });
});

describe("技能候选解析接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    ensureMock.ensureSystemSkills.mockResolvedValue(0);
  });

  it("返回正分候选及路由原因，供前端候选条展示", async () => {
    prismaMock.aiSkill.findMany.mockResolvedValue([
      skillRow({ code: "array_skill", name: "阵列技能", keywords: ["阵列"] }),
      skillRow({ code: "review_skill", name: "审查技能", keywords: ["检查"] }),
    ]);

    const res = await authed("post", "/api/skills/resolve").send({
      message: "帮我阵列一下",
      selectionTypes: ["CIRCLE"],
    });

    expect(res.status).toBe(200);
    expect(res.body.matchedSkills).toHaveLength(1);
    expect(res.body.matchedSkills[0]).toMatchObject({
      code: "array_skill",
      name: "阵列技能",
      tools: ["array_elements", "offset_elements"],
    });
    expect(res.body.matchedSkills[0].reasons.join()).toContain("keywords:");
    expect(res.body.matchedSkills[0].score).toBeGreaterThan(0);
  });

  it("推荐候选带 recommended 原因并越过激活阈值", async () => {
    prismaMock.aiSkill.findMany.mockResolvedValue([
      skillRow({ code: "array_skill", name: "阵列技能", keywords: [] }),
    ]);

    const res = await authed("post", "/api/skills/resolve").send({
      message: "继续处理",
      pinnedSkillCodes: ["array_skill"],
    });

    expect(res.status).toBe(200);
    expect(res.body.matchedSkills[0].score).toBeGreaterThanOrEqual(100);
    expect(res.body.matchedSkills[0].reasons).toContain("pinned");
  });

  it("接受 null 的 assistantId（前端未选择助手时的默认值）", async () => {
    prismaMock.aiSkill.findMany.mockResolvedValue([
      skillRow({ code: "array_skill", name: "阵列技能", keywords: ["阵列"] }),
    ]);

    const res = await authed("post", "/api/skills/resolve").send({
      message: "帮我阵列一下",
      assistantId: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.matchedSkills).toHaveLength(1);
  });

  it("拒绝未知的设计上下文信号", async () => {
    const res = await authed("post", "/api/skills/resolve").send({
      message: "画圆",
      contextSignals: ["unknown"],
    });
    expect(res.status).toBe(400);
  });
});
