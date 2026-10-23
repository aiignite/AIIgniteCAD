-- 技能剧本字段：步骤、完成检查、示例、所需上下文与负关键词
ALTER TABLE "ai_skills"
  ADD COLUMN "steps" JSONB,
  ADD COLUMN "checks" JSONB,
  ADD COLUMN "examples" JSONB,
  ADD COLUMN "required_context" JSONB,
  ADD COLUMN "negative_keywords" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
