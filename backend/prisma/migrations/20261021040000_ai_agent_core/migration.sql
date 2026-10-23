-- AlterTable
ALTER TABLE "assistants" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'General',
ADD COLUMN     "max_tokens" INTEGER,
ADD COLUMN     "max_tool_rounds" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "temperature" DOUBLE PRECISION,
ADD COLUMN     "tool_names" JSONB;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "client_message_id" TEXT,
ADD COLUMN     "completion_tokens" INTEGER,
ADD COLUMN     "model_row_id" TEXT,
ADD COLUMN     "prompt_tokens" INTEGER,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'complete',
ADD COLUMN     "tool_call_id" TEXT,
ADD COLUMN     "tool_calls" JSONB,
ADD COLUMN     "tool_name" TEXT,
ADD COLUMN     "trace_id" TEXT;

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "assistant_id" TEXT,
ADD COLUMN     "context_summary" TEXT,
ADD COLUMN     "context_summary_up_to_id" TEXT,
ADD COLUMN     "context_updated_at" TIMESTAMP(3),
ADD COLUMN     "last_message_at" TIMESTAMP(3),
ADD COLUMN     "model_id" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "llm_models" ADD COLUMN     "completion_price_per_1k" DOUBLE PRECISION,
ADD COLUMN     "context_window" INTEGER NOT NULL DEFAULT 128000,
ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "max_output_tokens" INTEGER,
ADD COLUMN     "prompt_price_per_1k" DOUBLE PRECISION,
ADD COLUMN     "supports_tools" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "temperature" DOUBLE PRECISION,
ADD COLUMN     "timeout_seconds" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "top_p" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ai_skills" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "prompt_template" TEXT NOT NULL,
    "tool_names" JSONB,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "selection_types" JSONB NOT NULL DEFAULT '[]',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_skills" (
    "assistant_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_skills_pkey" PRIMARY KEY ("assistant_id","skill_id")
);

-- CreateTable
CREATE TABLE "ai_call_logs" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "session_id" TEXT,
    "assistant_id" TEXT,
    "provider" TEXT NOT NULL,
    "model_row_id" TEXT,
    "model_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error_code" TEXT,
    "round" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "tool_call_count" INTEGER NOT NULL DEFAULT 0,
    "skill_codes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_skills_code_key" ON "ai_skills"("code");

-- CreateIndex
CREATE INDEX "ai_skills_user_id_idx" ON "ai_skills"("user_id");

-- CreateIndex
CREATE INDEX "ai_skills_is_enabled_idx" ON "ai_skills"("is_enabled");

-- CreateIndex
CREATE INDEX "ai_skills_category_idx" ON "ai_skills"("category");

-- CreateIndex
CREATE INDEX "assistant_skills_skill_id_idx" ON "assistant_skills"("skill_id");

-- CreateIndex
CREATE INDEX "ai_call_logs_user_id_created_at_idx" ON "ai_call_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_session_id_idx" ON "ai_call_logs"("session_id");

-- CreateIndex
CREATE INDEX "ai_call_logs_trace_id_idx" ON "ai_call_logs"("trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_session_id_client_message_id_key" ON "chat_messages"("session_id", "client_message_id");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_last_message_at_idx" ON "chat_sessions"("user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "llm_models_user_id_is_default_idx" ON "llm_models"("user_id", "is_default");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "llm_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skills" ADD CONSTRAINT "ai_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_skills" ADD CONSTRAINT "assistant_skills_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_skills" ADD CONSTRAINT "assistant_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "ai_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: 历史消息沿用 sender_type 语义填充 Provider 角色
UPDATE "chat_messages" SET "role" = CASE WHEN "sender_type" = 'ai' THEN 'assistant' ELSE 'user' END;

-- Backfill: 会话标题取首条用户消息，避免列表出现空标题
UPDATE "chat_sessions" cs SET "title" = left(m.content, 60)
FROM "chat_messages" m
WHERE m."session_id" = cs."id"
  AND cs."title" IS NULL
  AND m."sender_type" = 'user'
  AND m."created_at" = (
    SELECT MIN(m2."created_at") FROM "chat_messages" m2 WHERE m2."session_id" = cs."id"
  );
