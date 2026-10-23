-- 项目设计约定与版本变更摘要
ALTER TABLE "projects" ADD COLUMN "design_conventions" JSONB;

ALTER TABLE "project_versions" ADD COLUMN "change_summary" JSONB;
