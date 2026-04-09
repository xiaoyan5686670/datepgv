-- 用户管理模块迁移脚本
-- 添加省份、员工等级、区县市字段，支持省管理查看区县市数据，普通员工仅查看自己
-- 同时确保 roles 表有 province_manager 角色

-- 1. 添加新列到 users 表 (如果不存在)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS province VARCHAR(50),
ADD COLUMN IF NOT EXISTS employee_level VARCHAR(20) NOT NULL DEFAULT 'staff',
ADD COLUMN IF NOT EXISTS district VARCHAR(100),
ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);

-- 添加索引以支持按省份过滤
CREATE INDEX IF NOT EXISTS idx_users_province ON users(province);
CREATE INDEX IF NOT EXISTS idx_users_employee_level ON users(employee_level);

-- 2. 更新 employee_level 为现有用户 (防止约束违反)
UPDATE users SET employee_level = 'staff' WHERE employee_level IS NULL OR employee_level = '';

-- 3. 确保 roles 表有必要的角色
INSERT INTO roles (name, description) 
VALUES 
  ('admin', '系统管理员 - 完全访问权限'),
  ('province_manager', '省管理 - 可管理本省用户及查看本省区县数据'),
  ('user', '普通用户 - 仅查看自己数据')
ON CONFLICT (name) DO NOTHING;

-- 4. 为默认 admin 用户分配 admin 角色 (如果存在)
-- 假设默认管理员用户名为 'admin'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE username = 'admin') THEN
    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id 
    FROM users u, roles r 
    WHERE u.username = 'admin' 
      AND r.name = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM user_roles ur 
        WHERE ur.user_id = u.id AND ur.role_id = r.id
      );
  END IF;
END $$;

-- 5. 为现有用户分配默认角色 (如果没有角色)
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.name = 
  CASE 
    WHEN u.employee_level = 'admin' THEN 'admin'
    WHEN u.employee_level = 'province_manager' THEN 'province_manager'
    ELSE 'user'
  END
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
);

-- 验证
SELECT 'Migration completed. New columns and roles added.' as status;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
  AND column_name IN ('province', 'employee_level', 'district', 'full_name');

SELECT name, description FROM roles ORDER BY name;
