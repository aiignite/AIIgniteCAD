-- AlterTable
ALTER TABLE "elements" ADD COLUMN "element_id" TEXT;

-- CreateIndex
CREATE INDEX "elements_project_id_element_id_idx" ON "elements"("project_id", "element_id");

-- Backfill stable client element ids from existing geometry payloads
UPDATE "elements"
SET "element_id" = "geometry_data"->>'id'
WHERE "element_id" IS NULL
  AND jsonb_typeof("geometry_data") = 'object'
  AND jsonb_typeof("geometry_data"->'id') = 'string'
  AND length("geometry_data"->>'id') > 0;

-- Keep one active row per project/element id before enforcing uniqueness
DELETE FROM "elements" e
USING "elements" keep
WHERE e."project_id" = keep."project_id"
  AND e."element_id" = keep."element_id"
  AND e."is_deleted" = false
  AND keep."is_deleted" = false
  AND e."id" <> keep."id"
  AND (
    e."updated_at" < keep."updated_at"
    OR (e."updated_at" = keep."updated_at" AND e."id" < keep."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "elements_project_id_element_id_active_idx" ON "elements"("project_id", "element_id") WHERE "is_deleted" = false;
