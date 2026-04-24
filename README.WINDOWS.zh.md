# datepgv Windows 10 部署说明（中文版）

完整英文说明见 [README.WINDOWS.md](README.WINDOWS.md)。

> **脚本全文备份**（便于审计或离线恢复）：[docs/WIN10_RELEASE_CODE.md](docs/WIN10_RELEASE_CODE.md)。

## 架构

前端 Next.js + 后端 FastAPI + PostgreSQL。数据库表结构与种子数据以 **`db-bootstrap/` 内由 `pg_dump` 生成的快照**为准（`schema.sql`、`bootstrap_data.sql`），不再依赖手写 `init-db` 脚本链。

## 目标机（Windows 10）准备

1. **Python 3.11+**（安装时勾选 Add to PATH）。
2. **Node.js 18+ LTS** 与 npm。
3. **PostgreSQL 14+**，并创建应用库与用户；默认约定（与 `.env.example` 一致）：
   - 库名 `datepgv`，用户 `datepgv`，密码 `datepgv123`，端口 `5432`。
4. 在目标库执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

5. 配置 **`DATABASE_URL`**：将根目录 `.env.example` 复制为 `.env`（或 `backend/.env`），按实际主机/端口/密码修改连接串。

## 推荐部署顺序（分步 bat）

解压发布包后，仓库根目录的上一级为应用根（与开发克隆结构相同）。在 **`win10-release`** 目录中：

| 脚本 | 作用 |
|------|------|
| `Deploy-01-Backend.bat` | 创建 `backend\.venv` 并 `pip install -r backend\requirements.txt` |
| `Deploy-02-Frontend.bat` | `frontend` 下 `npm install` 与 `npm run build` |
| `Deploy-03-Database.bat` | 同上；若缺 `vector` 扩展权限，先在 CMD 执行 `set BOOTSTRAP_SUPERUSER_EXTENSION=1` 再运行本脚本，会提示输入 **postgres** 密码（或设 `BOOTSTRAP_SUPERUSER_PASSWORD` / `BOOTSTRAP_SUPERUSER_NAME`） |
| `Deploy-All.bat` | 按顺序执行上述三步 |
| `Start-Services.bat` | 校验配置后新开窗口启动后端与前端，并打开浏览器 |

**说明**：根目录下的 `run_win10_oneclick.bat`、`package_win10.bat`、`run_win10_onclick.bat` 以及 `package_win10_on_mac.sh` 已改为 **废弃桩脚本**（运行即提示并退出）；请使用 `win10-release` 与 `Publish-Win10-Artifact.bat` / `scripts/publish_win10_artifact.py`，并以本文档为准。

**关于 `start_backend.bat`**：日常只需运行 **`win10-release\Start-Services.bat`**，它会**自动**在新窗口里调用根目录的 `start_backend.bat` 启动后端；一般**不必**单独去双击 `start_backend.bat`。

### 环境变量（数据库还原）

- **`SKIP_BOOTSTRAP_DB=1`**：在运行 `Deploy-03-Database.bat` 前设置可跳过还原（例如仅重装前后端时）。
- **`FORCE_BOOTSTRAP_DB=1`**：强制 `--force` 还原（丢弃并重建 `public` schema 后导入快照；**会清空该库 public 下对象**）。
- **`BOOTSTRAP_SUPERUSER_EXTENSION=1`**：若当前库尚未安装 `vector`、且应用账号无权 `CREATE EXTENSION`，则脚本会用 **postgres**（或 `BOOTSTRAP_SUPERUSER_NAME`）连同一主机与库，并提示输入密码（也可用 **`BOOTSTRAP_SUPERUSER_PASSWORD`**，仅建议在无人值守环境使用且勿提交到 Git）。超级用户连接会**沿用 `DATABASE_URL` 里的查询串**（如 `?sslmode=require`），避免 SSL 不一致导致「connection was closed」。仍失败时可设 **`BOOTSTRAP_SUPERUSER_DATABASE_URL`** 为完整的 `postgresql://postgres:密码@主机:端口/库?参数`（勿提交仓库）。

在 CMD 中示例（强制重建 + 超级用户装 vector）：

```bat
set FORCE_BOOTSTRAP_DB=1
set BOOTSTRAP_SUPERUSER_EXTENSION=1
call win10-release\Deploy-03-Database.bat
```

## 启动后访问

- 前端：<http://localhost:3000>（局域网可用 `http://本机IP:3000`，见下方「无法通过 IP 访问」）
- API 文档：<http://localhost:8000/docs>
- 健康检查：<http://127.0.0.1:8000/health>

日常关闭：关闭标题为 `datepgv-backend` / `datepgv-frontend` 的窗口。

## 构建发布包（开发机）

在 **Windows、macOS 或 Ubuntu 22.x** 上（需已配置可连的 PostgreSQL 与 `pg_dump`）：

```bash
python3 scripts/publish_win10_artifact.py
```

可选：`--skip-export` 跳过重新导出（沿用当前 `db-bootstrap/`）。输出默认在 `dist/datepgv-win10.zip`。

Windows 上也可双击根目录 **`Publish-Win10-Artifact.bat`**（若已添加），内部调用同一 Python 脚本。

## 常见问题

- **超级用户连接 `connection was closed in the middle of operation`**：多为 **SSL 参数不一致**（应用 URL 带 `?sslmode=require` 等，超级用户连接未带）。请让 **`DATABASE_URL` 带上与 psql/服务端一致的查询参数**，更新 `restore_bootstrap_db.py` 后重试；或使用 **`BOOTSTRAP_SUPERUSER_DATABASE_URL`** 指定完整超级用户连接串。另核对 postgres 密码、`pg_hba.conf`、服务器是否已安装 vector 扩展包。
- **「必须是扩展 vector 的属主」**：`schema.sql` 里有 `COMMENT ON EXTENSION vector`，只有扩展属主或超级用户能执行。还原脚本已自动**跳过**这类语句（不影响使用）。请更新 `scripts/restore_bootstrap_db.py` 后重跑 `Deploy-03`。
- **`CREATE EXTENSION vector` 权限不够**：应用账号不是超级用户时，在 CMD 里先执行 `set BOOTSTRAP_SUPERUSER_EXTENSION=1`（若强制重建库再加 `set FORCE_BOOTSTRAP_DB=1`），再运行 `win10-release\Deploy-03-Database.bat`，按提示输入 **postgres**（或 `BOOTSTRAP_SUPERUSER_NAME`）的密码；非交互环境可设 `BOOTSTRAP_SUPERUSER_PASSWORD`（勿写入仓库）。也可在服务器上用手动执行一次：`psql -U postgres -d datepgv -c "CREATE EXTENSION IF NOT EXISTS vector;"`。
- **还原时报「在 \\ 附近语法错误」**：新版 `pg_dump` 会在 SQL 里写入仅 **psql** 识别的 `\\restrict` / `\\unrestrict` 行；`restore_bootstrap_db.py` 已自动剔除。请更新仓库里的 `scripts/restore_bootstrap_db.py` 后重试 `Deploy-03`（必要时仍加 `FORCE_BOOTSTRAP_DB=1`）。
- **`ModuleNotFoundError: asyncpg`**：部署脚本会在还原前 **激活 `backend\.venv` 并执行 `pip install -r backend\requirements.txt`**，并清空 `PYTHONHOME` / `PYTHONPATH`，避免系统 Python 干扰。若仍失败，删除 `backend\.venv` 后重新运行 `Deploy-01-Backend.bat`。
- **还原失败**：确认 PostgreSQL 已启动、`DATABASE_URL` 正确、已安装 `vector` 扩展。
- **后端无响应**：查看 `datepgv-backend` 窗口日志；确认库已还原且 `.env` 中 `DATABASE_URL` 与库一致。
- **前端 404/白屏**：先执行 `Deploy-02-Frontend.bat` 生成 `frontend\.next`。
- **无法通过局域网 IP 访问 `http://x.x.x.x:3000`**：（1）确认 **`datepgv-frontend` 窗口已启动**且无报错。（2）`npm run start` / `npm run dev` 已配置为监听 **`0.0.0.0:3000`**；在**运行前端的机器**上执行 `netstat -an | findstr ":3000"`，应看到 `0.0.0.0:3000` 为 `LISTENING`。（3）**Windows 防火墙**：若本机 IP 从其他电脑打不开，在「高级安全 Windows Defender 防火墙」中为 **入站规则** 放行 **Node.js** 或 **TCP 3000**（仅可信内网时配置）。（4）确认浏览器里的 IP 是**跑前端的这台机器**的网卡地址，且与客户端在同一网段/路由可达。
