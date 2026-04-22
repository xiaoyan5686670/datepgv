## 在 Windows 10/11 上运行 datepgv

本指南适用于希望在 Windows 10/11 本机上运行本项目（Next.js 前端 + FastAPI 后端）的场景，默认通过浏览器访问 `http://localhost:3000`。

### 1. 必备软件

- **Python**: 3.11 或更新版本（安装时勾选 “Add Python to PATH”）
- **Node.js**: LTS 版本（推荐 18 或 20）
- **Git**: 用于克隆/更新仓库（可选）
- **PostgreSQL**: 14+，并启用 `pgvector` 扩展
- （可选）**Docker Desktop for Windows**: 若希望使用 `docker compose` 简化环境

### 2. 克隆或拷贝代码

将本仓库放到本机某个目录，例如：

```text
C:\dev\datepgv
```

以下命令均假设当前目录为仓库根目录。

```powershell
cd C:\dev\datepgv
```

### 3. 配置 PostgreSQL + pgvector

1. 安装 PostgreSQL（可用官方安装包）。
2. 创建数据库（名称可自定义，例如 `datepgv`）。
3. 在目标数据库中启用 `pgvector` 扩展（示例）：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

4. 根据你的环境，准备好数据库连接参数（host、port、user、password、dbname）。

### 4. 配置后端（FastAPI）

#### 4.1 使用批处理脚本（推荐）

在仓库根目录下，双击或从命令行执行：

```bat
start_backend.bat
```

该脚本会：

- 在 `backend\.venv` 中创建并激活 Python 虚拟环境（若不存在）。
- 执行 `pip install -r backend\requirements.txt` 安装依赖。
- 若不存在 `backend\.env` 且存在根目录 `.env.example`，会复制为 `backend\.env`（请根据实际环境修改）。
- 切换到 `backend` 目录并启动：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动完成后，可访问：

- 后端 API 文档: `http://localhost:8000/docs`

#### 4.2 手动步骤（等价于脚本所做的事）

```powershell
cd C:\dev\datepgv\backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example .env  # 然后编辑 .env，配置 DATABASE_URL 等
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

请在 `.env` 中配置正确的数据库连接，例如：

```env
DATABASE_URL=postgresql+asyncpg://datepgv:datepgv123@localhost:5432/datepgv
```

以及你选择的 LLM/Embedding 服务的 API Key（可参考 `README.md` 中 “快速开始” 小节）。

### 5. 配置前端（Next.js）

#### 5.1 使用批处理脚本（推荐）

在仓库根目录下执行：

```bat
start_frontend.bat
```

该脚本会：

- 进入 `frontend` 目录。
- 在缺少 `node_modules` 时执行 `npm install`。
- 启动开发服务器：

```bash
npm run dev
```

启动完成后，可访问：

- 前端 Chatbot: `http://localhost:3000`

#### 5.2 手动步骤

```powershell
cd C:\dev\datepgv\frontend
npm install
npm run dev
```

如需生产模式：

```powershell
npm run build
npm run start
```

前端默认通过 Next 的 `/api/backend` 转发到本机 `http://127.0.0.1:8000`，一般**不必**再配 `NEXT_PUBLIC_API_URL`。若后端跑在非本机或非常规端口，可改 `frontend/next.config.js` 里的代理目标，或为 Next 进程设置 `BACKEND_URL`。

### 6. 一键启动所有服务（可选）

仓库根目录提供了一个总控脚本：

```bat
start_all.bat
```

它会在两个新的命令行窗口中分别启动：

- 后端（调用 `start_backend.bat`）
- 前端（调用 `start_frontend.bat`）

脚本执行后，你可以直接在浏览器打开：

- `http://localhost:3000`

### 7. 在 Windows 上使用 Docker（可选）

若你已安装 Docker Desktop for Windows，可以直接使用仓库自带的 `docker-compose.yml`：

```powershell
cd C:\dev\datepgv
docker compose up -d
```

> 说明：当前 `docker-compose.yml` 默认假设 **PostgreSQL 在宿主机上运行**，并通过环境变量 `DATABASE_URL` 或 `POSTGRES_*` 连接。你可以：
>
> - 在 Windows 本机安装并启动 PostgreSQL，然后设置 `.env` 中的连接信息；
> - 或者自行扩展 `docker-compose.yml`，增加一个 `postgres` 服务，并初始化 `pgvector`。

启动后，访问地址与 `README.md` 中说明相同：

- 前端 Chatbot: `http://localhost:3000`
- 后端 API 文档: `http://localhost:8000/docs`

### 8. 常见问题

- **端口占用**: 若改了 FastAPI 端口，请同步修改 `frontend/next.config.js` 中的代理地址或设置环境变量 `BACKEND_URL`。
- **虚拟环境激活失败**: 检查是否使用了 PowerShell（可能需要执行策略设置 `Set-ExecutionPolicy RemoteSigned`），或改用 `cmd` 运行批处理。
- **无法连接数据库**: 核对 `.env` 中的 `DATABASE_URL` 是否与 PostgreSQL 实际配置一致，确认 `pgvector` 已启用。
- **`ModuleNotFoundError: No module named 'encodings'`**: 常见于系统 `PYTHONHOME`/`PYTHONPATH` 被污染或 Python 安装损坏。新版一键脚本会自动清理这两个变量并优先使用 `py -3`；若仍失败，请重装 Python（官方安装包）后重试。

### 9. Win10 一键运行（生产模式）

如果你希望给 Windows 用户一个“解压后双击就能跑”的版本，使用仓库根目录新增脚本：

- `run_win10_oneclick.bat`：自动检查 Python/Node、初始化后端虚拟环境、安装依赖、构建前端，并启动前后端（生产模式）；若缺少 `backend\.env`，优先从根目录 `.env` 复制。
- `run_win10_onclick.bat`：兼容入口（会转调 `run_win10_oneclick.bat`，用于避免文件名拼写差异）。
- `package_win10.bat`：生成分发包目录和 zip，输出到 `dist/datepgv-win10-oneclick` 与 `dist/datepgv-win10-oneclick.zip`；打包时优先封装根目录 `.env`（同时保留 `.env.example` 作为模板）。

推荐流程：

1. 在开发机根目录运行：

```bat
package_win10.bat
```

2. 把 `dist/datepgv-win10-oneclick.zip` 发给 Windows 10 用户。
3. 用户解压后，双击：

```bat
run_win10_oneclick.bat
```

首次运行会安装依赖并构建前端，耗时较长；后续启动会明显更快。

#### 如果你在 macOS 上打包给 Windows 用户

`.bat` 无法在 macOS 直接执行。可在仓库根目录运行：

```bash
chmod +x package_win10_on_mac.sh
./package_win10_on_mac.sh
```

然后把生成的 `dist/datepgv-win10-oneclick.zip` 发给 Win10 用户，用户在 Windows 解压后双击 `run_win10_oneclick.bat`（或 `run_win10_onclick.bat`）即可（包内已优先带 `.env`）。

