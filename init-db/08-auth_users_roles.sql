-- 用户与角色（JWT 登录、RBAC）
-- 默认账号（部署后请立即修改密码）：
--   admin / changeme   — 角色 admin（模型配置、元数据维护、数据连接）
--   analyst / changeme — 角色 user（对话与只读元数据）

CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL UNIQUE,
    description VARCHAR(255),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles (role_id);

-- 与 01-init.sql 一致；旧库若从未跑过 01，此处会补建函数，避免触发器报错。
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 预置角色
INSERT INTO roles (name, description)
SELECT v.name, v.description
FROM (VALUES
    ('admin', '管理员：配置 LLM、数据连接、元数据维护'),
    ('user',  '普通用户：使用对话与查看元数据')
) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = v.name);

-- 密码均为 changeme（bcrypt）
INSERT INTO users (username, password_hash, is_active)
SELECT v.username, v.password_hash, TRUE
FROM (VALUES
    (
        'admin',
        '$2b$12$4CC80mdRBimXLZmWyu84iOOlSORMHQify3YNNFD/X4SDRcLK/eZKK'
    ),
    (
        'analyst',
        '$2b$12$4CC80mdRBimXLZmWyu84iOOlSORMHQify3YNNFD/X4SDRcLK/eZKK'
    )
) AS v(username, password_hash)
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.username = v.username);

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE u.username = 'admin' AND r.name = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE u.username = 'analyst' AND r.name = 'user'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
