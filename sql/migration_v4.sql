-- migration_v4: 超级管理员 + 手动排序
-- 给 users 表加 is_super_admin 字段,默认 false(不自动设置任何人)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- 给 users 表加 sort_order 字段,用于手动排序
ALTER TABLE users ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
