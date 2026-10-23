-- 版本列表无需加载完整快照，单独记录图元数量供列表与对比摘要使用
ALTER TABLE "project_versions" ADD COLUMN "element_count" INTEGER NOT NULL DEFAULT 0;
