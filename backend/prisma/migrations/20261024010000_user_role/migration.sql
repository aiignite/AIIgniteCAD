-- 用户角色：首个管理员由启动时的 bootstrap 逻辑提升（最早注册的用户）
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
