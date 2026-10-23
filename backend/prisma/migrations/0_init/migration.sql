-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_opened_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drawing_settings" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "units" TEXT NOT NULL DEFAULT 'mm',
    "grid_spacing" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "snap_distance" DECIMAL(10,2) NOT NULL DEFAULT 5,
    "dim_scale" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "dim_precision" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drawing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layers" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "line_type" TEXT NOT NULL DEFAULT 'CONTINUOUS',
    "line_weight" DECIMAL(5,2),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_definitions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_point_x" DECIMAL(15,6) NOT NULL,
    "base_point_y" DECIMAL(15,6) NOT NULL,
    "thumbnail" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "category_id" TEXT,

    CONSTRAINT "block_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_categories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "block_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_elements" (
    "id" TEXT NOT NULL,
    "block_definition_id" TEXT NOT NULL,
    "element_data" JSONB NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_references" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "block_definition_id" TEXT NOT NULL,
    "layer_id" TEXT,
    "insertion_point_x" DECIMAL(15,6) NOT NULL,
    "insertion_point_y" DECIMAL(15,6) NOT NULL,
    "rotation_angle" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "scale_x" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "scale_y" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "properties" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "block_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elements" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "layer_id" TEXT,
    "element_type" TEXT NOT NULL,
    "geometry_data" JSONB NOT NULL,
    "properties" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_versions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "snapshot_data" JSONB NOT NULL,
    "commit_message" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_models" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "api_key_encrypted" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "configuration" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "llm_model_id" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "prompt" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "projects_user_id_idx" ON "projects"("user_id");

-- CreateIndex
CREATE INDEX "projects_updated_at_idx" ON "projects"("updated_at");

-- CreateIndex
CREATE INDEX "projects_last_opened_at_idx" ON "projects"("last_opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "drawing_settings_project_id_key" ON "drawing_settings"("project_id");

-- CreateIndex
CREATE INDEX "layers_project_id_idx" ON "layers"("project_id");

-- CreateIndex
CREATE INDEX "layers_display_order_idx" ON "layers"("display_order");

-- CreateIndex
CREATE INDEX "block_definitions_user_id_idx" ON "block_definitions"("user_id");

-- CreateIndex
CREATE INDEX "block_definitions_project_id_idx" ON "block_definitions"("project_id");

-- CreateIndex
CREATE INDEX "block_definitions_name_idx" ON "block_definitions"("name");

-- CreateIndex
CREATE INDEX "block_definitions_is_public_idx" ON "block_definitions"("is_public");

-- CreateIndex
CREATE INDEX "block_definitions_category_id_idx" ON "block_definitions"("category_id");

-- CreateIndex
CREATE INDEX "block_categories_user_id_idx" ON "block_categories"("user_id");

-- CreateIndex
CREATE INDEX "block_categories_project_id_idx" ON "block_categories"("project_id");

-- CreateIndex
CREATE INDEX "block_categories_parent_id_idx" ON "block_categories"("parent_id");

-- CreateIndex
CREATE INDEX "block_elements_block_definition_id_idx" ON "block_elements"("block_definition_id");

-- CreateIndex
CREATE INDEX "block_elements_display_order_idx" ON "block_elements"("display_order");

-- CreateIndex
CREATE INDEX "block_references_project_id_idx" ON "block_references"("project_id");

-- CreateIndex
CREATE INDEX "block_references_block_definition_id_idx" ON "block_references"("block_definition_id");

-- CreateIndex
CREATE INDEX "block_references_layer_id_idx" ON "block_references"("layer_id");

-- CreateIndex
CREATE INDEX "elements_project_id_idx" ON "elements"("project_id");

-- CreateIndex
CREATE INDEX "elements_layer_id_idx" ON "elements"("layer_id");

-- CreateIndex
CREATE INDEX "elements_element_type_idx" ON "elements"("element_type");

-- CreateIndex
CREATE INDEX "elements_is_deleted_idx" ON "elements"("is_deleted");

-- CreateIndex
CREATE INDEX "project_versions_project_id_idx" ON "project_versions"("project_id");

-- CreateIndex
CREATE INDEX "project_versions_created_at_idx" ON "project_versions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_versions_project_id_version_number_key" ON "project_versions"("project_id", "version_number");

-- CreateIndex
CREATE INDEX "chat_sessions_project_id_idx" ON "chat_sessions"("project_id");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_idx" ON "chat_sessions"("user_id");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages"("session_id");

-- CreateIndex
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages"("created_at");

-- CreateIndex
CREATE INDEX "llm_models_user_id_idx" ON "llm_models"("user_id");

-- CreateIndex
CREATE INDEX "llm_models_provider_idx" ON "llm_models"("provider");

-- CreateIndex
CREATE INDEX "llm_models_is_active_idx" ON "llm_models"("is_active");

-- CreateIndex
CREATE INDEX "assistants_user_id_idx" ON "assistants"("user_id");

-- CreateIndex
CREATE INDEX "assistants_is_active_idx" ON "assistants"("is_active");

-- CreateIndex
CREATE INDEX "assistants_llm_model_id_idx" ON "assistants"("llm_model_id");

-- CreateIndex
CREATE INDEX "assistants_is_public_idx" ON "assistants"("is_public");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_settings" ADD CONSTRAINT "drawing_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_definitions" ADD CONSTRAINT "block_definitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_definitions" ADD CONSTRAINT "block_definitions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_definitions" ADD CONSTRAINT "block_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "block_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_categories" ADD CONSTRAINT "block_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_categories" ADD CONSTRAINT "block_categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_categories" ADD CONSTRAINT "block_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "block_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_elements" ADD CONSTRAINT "block_elements_block_definition_id_fkey" FOREIGN KEY ("block_definition_id") REFERENCES "block_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_references" ADD CONSTRAINT "block_references_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_references" ADD CONSTRAINT "block_references_block_definition_id_fkey" FOREIGN KEY ("block_definition_id") REFERENCES "block_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_references" ADD CONSTRAINT "block_references_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_models" ADD CONSTRAINT "llm_models_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_llm_model_id_fkey" FOREIGN KEY ("llm_model_id") REFERENCES "llm_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
