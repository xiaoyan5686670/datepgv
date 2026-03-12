# 本地开发模式（无 Docker）

本指南适用于在 macOS 上**完全不使用 Docker** 运行本项目（例如无法安装或拉取 Docker 镜像的老旧 Mac）。数据库、后端、前端均在本机直接运行。按下列步骤完成后，可运行 **`./scripts/dev-local.sh`** 或分别启动 backend / frontend 以启动应用。

## 前置条件

- **macOS**，已安装 [Homebrew](https://brew.sh/)
- **Python 3.11+**（与 backend 要求一致）
- **Node 18+**（与 frontend 要求一致）

## 1. 安装并启动 PostgreSQL

### 安装 PostgreSQL

```bash
brew install postgresql@16
```

（也可使用当前 Homebrew 推荐的版本，如 `postgresql@15`，需与下方 pgvector 兼容。）

### 安装 pgvector 扩展

pgvector 用于向量检索，必须安装。

**方式 A：Homebrew（若存在 formula）**

```bash
brew install pgvector
```

若提示找不到 formula，使用方式 B。

**方式 B：从源码编译**

参见 [pgvector 官方文档](https://github.com/pgvector/pgvector#macos)，简要步骤：

PostgreSQL（如 EnterpriseDB 安装的）自带的 `pg_config --cflags` 会注入 `-isysroot .../MacOSX14.sdk`，且该路径在编译命令里排在后面，会覆盖你传入的 CFLAGS；若本机只有 `MacOSX12.sdk`，就会报 `no such sysroot` 或 `stdio.h file not found`。

**推荐做法：让“MacOSX14.sdk”指向本机已有的 SDK（建符号链接）**，这样无需改 Makefile，编译时会自动用 12 的头文件：

```bash
# 1. 确认本机已有的 SDK（例如 MacOSX12.sdk）
ls /Library/Developer/CommandLineTools/SDKs/

# 2. 若没有 MacOSX14.sdk，则建一个指向当前 SDK 的符号链接（需 sudo）
sudo ln -sf /Library/Developer/CommandLineTools/SDKs/MacOSX12.sdk /Library/Developer/CommandLineTools/SDKs/MacOSX14.sdk

# 3. 再编译安装 pgvector
cd /path/to/pgvector
make OPTFLAGS=""
make install
```

若你机器上是其他名称（如 `MacOSX13.sdk`），把上面 `MacOSX12.sdk` 换成实际存在的目录名即可。

> **macOS 12 / 旧版 Clang**  
> - 若报错 `clang: error: the clang compiler does not support '-march=native'`，请使用 `make OPTFLAGS=""`。  
> - 若报错 `'stdio.h' file not found` 或 `no such sysroot directory: .../MacOSX14.sdk`：多半是 pg_config 注入了不存在的 MacOSX14.sdk。按上面步骤建符号链接 `MacOSX14.sdk` → 本机已有的 SDK 后再 `make OPTFLAGS=""` 即可。

安装后需确保 PostgreSQL 能加载该扩展（扩展目录在 `pg_config --pkglibdir` 或 `sharedir`/extension）。

### 启动 PostgreSQL

```bash
brew services start postgresql@16
```

（若使用其他版本，替换为对应服务名，如 `postgresql@15`。）

## 2. 创建数据库并执行初始化

本节分为两种方式：

- **2.1 最小初始化（必需）**：只创建数据库用户/库和空表结构，让后端能正常运行，后续所有业务配置都在 Web 里完成。  
- **2.2 示例数据（可选）**：一次性导入演示用的元数据和模型预设，方便快速体验。

推荐做法：**如果你只是想先把 Web 系统跑起来，可以先完成 2.1，等能访问 `/settings` 和 `/admin` 后，再决定要不要执行 2.2。**

### 2.1 最小初始化（必需）

#### 创建用户与数据库

与 [.env.example](../.env.example) 保持一致：

- 用户：`datepgv`
- 密码：`datepgv123`
- 数据库：`datepgv`

使用 `createuser` / `createdb` 或 `psql` 创建，例如（以默认 brew 安装后的 superuser 执行）：

```bash
createuser -s datepgv
psql -d postgres -c "ALTER USER datepgv WITH PASSWORD 'datepgv123';"
createdb -O datepgv datepgv
```

或使用你本机已有的 PostgreSQL 管理方式创建上述用户和库。

#### 创建最小表结构

在项目根目录下，进入 `psql` 并执行最小初始化 SQL（只建表，不导入任何示例数据）：

```bash
psql -U datepgv -d datepgv -h localhost
```

在 `psql` 提示符下执行：

```sql
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 表元数据表（精简版）
CREATE TABLE IF NOT EXISTS table_metadata (
    id            SERIAL PRIMARY KEY,
    db_type       VARCHAR(20) NOT NULL CHECK (db_type IN ('hive', 'postgresql')),
    database_name VARCHAR(200),
    schema_name   VARCHAR(200),
    table_name    VARCHAR(200) NOT NULL,
    table_comment TEXT,
    columns       JSONB NOT NULL DEFAULT '[]',
    sample_data   JSONB,
    tags          TEXT[],
    embedding     vector(1536),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 聊天会话 & 消息表（精简版）
CREATE TABLE IF NOT EXISTS chat_sessions (
    id         SERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id         SERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content    TEXT NOT NULL,
    sql_type   VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LLM & Embedding 配置表（不含任何预设数据）
CREATE TABLE IF NOT EXISTS llm_configs (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    config_type  VARCHAR(20)  NOT NULL CHECK (config_type IN ('llm', 'embedding')),
    model        VARCHAR(200) NOT NULL,
    api_key      TEXT,
    api_base     VARCHAR(500),
    extra_params JSONB        NOT NULL DEFAULT '{}',
    is_active    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- 应用设置（Embedding 维度等，可在设置页修改）
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('embedding_dim', '1536')
ON CONFLICT (key) DO NOTHING;
```

只要完成 2.1，后端就可以正常启动；接下来你可以直接通过 Web 界面配置所有模型和表元数据。

### 2.2 示例数据（可选）

如果你希望**快速体验完整效果**（包括示例的 Hive/PostgreSQL 表元数据和若干模型预设），可以直接执行完整的初始化脚本，它会包含上面的表结构以及演示数据：

```bash
psql -U datepgv -d datepgv -h localhost -f init-db/01-init.sql
```

执行完成后：

- `/admin` 页面会预置一些 Hive/PostgreSQL 示例表，方便直接提问；  
- `/settings` 页面中会出现多条 LLM/Embedding 配置记录，方便直接选择和调整。

**Embedding 维度**：在 **设置 → Embedding 向量维度** 中选择与当前激活的 Embedding 模型一致的维度（768 / 1536 / 3072）。保存后会自动迁移数据库；修改后需重启后端，并在元数据管理页执行「全部重新向量化」。

如果你更倾向于**完全自己配置**，可以跳过 2.2，启动系统后在 `/settings` 和 `/admin` 里从零创建所有配置和表元数据。

#### 修复「fact_sales / 部门维度表」后的操作（可选）

若你已按计划修复了示例表（Hive 示例含 `fact_sales` + `dim_user`，种子含 `fact_sales`），可按需做以下操作，**无需改其它代码**：

| 场景 | 操作 |
|------|------|
| **数据库尚未执行过 01-init.sql** | 执行一次：`psql -U datepgv -d datepgv -h localhost -f init-db/01-init.sql` |
| **数据库之前执行过 01-init.sql（当时没有 fact_sales 种子）** | 只补充 fact_sales：`psql -U datepgv -d datepgv -h localhost -f init-db/03-add-fact-sales-seed.sql` |
| **前端** | 若使用 `npm run dev`，通常已热更新；若示例仍为单表，可重启前端 |
| **后端** | 未改后端代码，无需重启 |
| **向量检索更准** | 执行完上述 SQL 后，在 **Admin 元数据管理** 页点击「全部重新向量化」，使新/更新的表参与语义检索 |

## 3. 环境变量

在项目根目录：

```bash
cp .env.example .env
# 按需编辑 .env
```

保持与本地开发一致即可，例如：

- `DATABASE_URL=postgresql+asyncpg://datepgv:datepgv123@localhost:5432/datepgv`
- `NEXT_PUBLIC_API_URL=http://localhost:8000`

大模型与 Embedding 在应用内「设置」页（http://localhost:3000/settings）自助选择并填写 API Key，无需在 .env 中配置。

## 4. 启动后端

在项目根目录：

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

后端会读取项目根目录或 `backend` 下的 `.env`（若存在）。若 `.env` 在根目录，可从根目录执行：

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

确保 `DATABASE_URL` 指向本机 PostgreSQL。

## 5. 启动前端

另开一个终端，在项目根目录：

```bash
cd frontend
npm install
npm run dev
```

- 前端 Chatbot: http://localhost:3000  
- 后端 API 文档: http://localhost:8000/docs  

## 6. 可选：使用一键启动脚本

若已按上述步骤安装并初始化好 PostgreSQL，可使用脚本同时启动后端与前端（仅负责启动进程，不安装依赖）：

```bash
./scripts/dev-local.sh
```

详见脚本内注释；**使用前请先完成 LOCAL_DEV.md 中的 PostgreSQL 安装与 init-db 步骤。**

## 注意事项

- **pgvector**：在部分老旧 macOS 上可能需要从源码编译，见 [pgvector 官方安装说明](https://github.com/pgvector/pgvector#installation)。
- **Embedding 维度**：在设置页的「Embedding 向量维度」中选择，无需改 .env；修改后重启后端并执行「全部重新向量化」。
- 本模式不涉及任何 Docker 命令，适合无法使用或拉取镜像的环境。
