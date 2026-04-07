# 部署与认证迁移指南

本文说明在引入 **JWT 登录与 RBAC** 后，如何完成**新环境部署**或**已有环境升级**。按顺序执行即可；生产环境请务必修改默认密码与 `JWT_SECRET_KEY`。

---

## 1. 升级会带来什么变化


| 项目  | 说明                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| 前端  | 首页、表关系图需**登录**；`/admin`、`/settings` 需 `**admin` 角色**。公开页：`/login`、`/docs`。                                                |
| 后端  | `/api/v1/chat/`*、`/api/v1/metadata/*`、`/api/v1/config/*` 均受保护；`/api/v1/auth/token`、`/api/v1/auth/me` 为认证接口；`/api/v1/auth/trusted-login` 为办公网免密入口（匿名）；`/health` 仍匿名。 |
| 数据库 | 新增 `roles`、`users`、`user_roles` 表及种子用户（见 `init-db/08-auth_users_roles.sql`）。                                              |
| 依赖  | 后端增加 `python-jose[cryptography]`、`bcrypt`（见 `backend/requirements.txt`）。                                                  |


---

## 2. 新环境从零部署（推荐顺序）

### 2.1 代码与环境变量

```bash
git pull   # 或 clone 到目标目录
cp .env.example .env
```

编辑 `.env`，至少保证 `**DATABASE_URL**` 正确，并增加 **JWT** 相关变量（见下文 [4. 环境变量](#4-环境变量)）。

### 2.2 数据库初始化

在**已创建的空库**上按编号执行 `init-db`（或你方既有流程中已包含的全部脚本）。**至少**需要：

1. `01-init.sql`（及你项目已依赖的 `02`～`07` 等）
2. `**08-auth_users_roles.sql`**（用户与角色）

示例（本机 `psql`，按实际主机/用户/库名修改）：

```bash
export PGHOST=localhost
export PGPORT=5432
export PGUSER=datepgv
export PGDATABASE=datepgv
# 按需 export PGPASSWORD=...

psql -v ON_ERROR_STOP=1 -f init-db/01-init.sql
# … 若项目要求，依次执行 02～07 …
psql -v ON_ERROR_STOP=1 -f init-db/08-auth_users_roles.sql
```

若使用 **Docker 官方 Postgres 镜像** 且通过 `/docker-entrypoint-initdb.d` 挂载整个 `init-db`，请保证文件名排序下 `**08-auth_users_roles.sql` 在 `01` 之后执行**（当前数字前缀已满足）。

### 2.3 安装依赖并启动

**Docker Compose（本仓库 `docker-compose.yml` 仅含 backend + frontend 时）：**

```bash
docker compose build --no-cache backend
docker compose up -d
```

**本机 Python + Node：**

```bash
cd backend && pip install -r requirements.txt
cd ../frontend && npm install && npm run build   # 生产；开发用 npm run dev
```

按你原有方式启动 `uvicorn` 与 `next`（或进程管理器）。

### 2.4 验证

1. 浏览器打开前端（如 `http://localhost:3000`），应跳转 `**/login**`。
2. 使用默认管理员登录：`admin` / `changeme`（见第 6 节立即改密）。
3. 打开 `/admin`、`/settings` 应正常；用 `**analyst` / `changeme**`（`user` 角色）登录时不应能进入上述两页，但可使用对话与表关系图。

---

## 3. 已有环境升级迁移（保留现有数据）

在**已存在业务数据**的库上，只需**增量**应用认证相关对象与种子数据，**不要**重跑会破坏数据的 `01-init` 全量建表（除非你有意重建库）。

### 3.1 备份（必做）

```bash
pg_dump -h <HOST> -U <USER> -d <DB> -Fc -f datepgv_pre_auth_$(date +%Y%m%d).dump
```

### 3.2 执行 SQL 迁移

```bash
psql -h <HOST> -U <USER> -d <DB> -v ON_ERROR_STOP=1 -f init-db/08-auth_users_roles.sql
```

说明：

- 脚本使用 `CREATE TABLE IF NOT EXISTS` 与 `WHERE NOT EXISTS` 插入种子，**重复执行**一般不会重复插入同用户/角色关联；若你已手动创建同名 `admin`/`analyst` 用户，请先检查冲突再执行。
- `08-auth_users_roles.sql` 内已包含 `**update_updated_at()`** 的 `CREATE OR REPLACE`（与 `01-init.sql` 一致），单独执行 `08` 时也会自动补建该函数。

### 3.3 更新应用与依赖

```bash
git pull
cd backend && pip install -r requirements.txt
cd ../frontend && npm install
```

容器环境：

```bash
docker compose build --no-cache backend
docker compose up -d
```

### 3.4 配置 JWT（生产必做）

在 `.env` 中设置强随机 `**JWT_SECRET_KEY**`（见第 4 节），**重启后端**使配置生效。

### 3.5 验证

同 [2.4 验证](#24-验证)。另用 `curl` 快速测 token：

```bash
TOKEN=$(curl -s -X POST "http://127.0.0.1:8000/api/v1/auth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=changeme" | jq -r .access_token)

curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8000/api/v1/auth/me"
```

---

## 4. 环境变量

在 `.env` 中可增加（或保持默认仅用于开发）：


| 变量                            | 说明                  | 示例                         |
| ----------------------------- | ------------------- | -------------------------- |
| `JWT_SECRET_KEY`              | 签名密钥，**生产必须**改为长随机串 | `openssl rand -hex 32` 的输出 |
| `JWT_ALGORITHM`               | 默认 `HS256`          | 一般不改                       |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 访问令牌有效期（分钟）         | `1440`（24h）                |
| `TRUSTED_SSO_FRONTEND_BASE`   | 免密登录成功后浏览器跳转的前端根 URL | `http://localhost:3000` 或生产 HTTPS 域名 |
| `TRUSTED_SSO_SECRET`         | （可选）非空则请求必须带请求头 `X-Trusted-Sso-Secret`，值与此一致；可由网关注入 | 长随机串 |
| `TRUSTED_SSO_ACCESS_TOKEN_MINUTES` | （可选）仅 `trusted-login` 签发 JWT 的有效期（分钟）；不设则与 `ACCESS_TOKEN_EXPIRE_MINUTES` 相同 | `480` |


将上述变量写入根目录 `.env`；`docker-compose.yml` 中 backend 已 `env_file: .env`，会传入容器。

---

## 5. 默认账号与密码策略

`08-auth_users_roles.sql` 预置：


| 用户名       | 角色      | 默认密码       | 用途                |
| --------- | ------- | ---------- | ----------------- |
| `admin`   | `admin` | `changeme` | 元数据、模型配置、数据连接等    |
| `analyst` | `user`  | `changeme` | 对话、只读元数据 API、表关系图 |


**生产环境请立即：**

1. 修改密码（需自行实现「改密接口」或在库中更新 `users.password_hash`，哈希算法为 **bcrypt**，与后端 `bcrypt` 库一致）。
2. 或删除示例用户，仅保留你方创建的账号（仍须正确写入 `user_roles`）。

生成 bcrypt 哈希示例（在已安装 `bcrypt` 的环境中）：

```bash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'你的新密码', bcrypt.gensalt()).decode())"
```

将输出更新到 `users.password_hash` 对应行。

---

## 6. OpenAPI / 自动化调用

- 浏览器打开 `http://<backend>:8000/docs`。
- 先调用 `**POST /api/v1/auth/token**`（OAuth2 密码流，`username`/`password` 表单），复制 `access_token`。
- 点击页面 **Authorize**，输入 `Bearer <access_token>`，即可调试受保护接口。

机器对机器调用：每次请求头携带：

```http
Authorization: Bearer <access_token>
```

---

## 7. 故障排查


| 现象                              | 可能原因                | 处理                                                       |
| ------------------------------- | ------------------- | -------------------------------------------------------- |
| 登录 401 / 数据库报错                  | 未执行 `08` 或表不存在      | 执行 `08-auth_users_roles.sql` 并查看后端日志                     |
| 所有 API 401                      | 未带 Token 或 Token 过期 | 重新登录；检查前端 `localStorage` 与 `api.ts` 是否携带 `Authorization` |
| `/settings` 403                 | 当前用户非 `admin`       | 使用 `admin` 账号或给用户绑定 `admin` 角色                           |
| 后端启动失败 / import 错误              | 未安装新依赖              | `pip install -r backend/requirements.txt` 或重建镜像          |
| 修改 `JWT_SECRET_KEY` 后旧 Token 失效 | 预期行为                | 重新登录                                                     |


---

## 8. 回滚思路（紧急）

1. 使用升级前 `**pg_dump**` 恢复数据库；或手动 `DROP TABLE user_roles, users, roles CASCADE`（**谨慎**，仅当无其他对象依赖且你清楚影响）。
2. 检出升级前 Git 版本并重新部署旧镜像/依赖。

建议在变更窗口前完成备份与演练。

---

## 9. 办公网免密登录（trusted user_id）

适用于**办公网**：上游系统仅需提供带 `user_id` 的链接（如门户图标），无需改上游业务代码传签名。

### 9.1 行为说明

- **接口**：`GET /api/v1/auth/trusted-login?user_id=<工号或用户名>`
- **匹配规则**：`user_id` 与表 `users.username` **大小写不敏感**（如 `XY007801` 与 `xy007801` 等价）。
- **成功**：HTTP **302**，`Location` 指向 `{TRUSTED_SSO_FRONTEND_BASE}/sso/callback#access_token=<JWT>`（JWT 已 URL 编码）。前端 `/sso/callback` 将 token 写入 `localStorage` 后进入系统。
- **可选**：`next` 查询参数，`/` 开头的站内路径，例如  
  `.../trusted-login?user_id=XY007801&next=%2Fadmin`（须 [URL 编码](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent)）。
- **失败**：统一返回 **404**「登录失败」或 **409**（多条用户命中，数据异常），避免枚举账号。**停用用户**同样拒绝。

### 9.2 上游链接示例（经 Next 代理）

本机开发（前端 3000、代理到后端）：

```text
http://localhost:3000/api/backend/auth/trusted-login?user_id=XY007801
```

生产请将 `localhost:3000` 换为实际前端域名，并保证 `.env` 中 **`TRUSTED_SSO_FRONTEND_BASE`** 与浏览器访问的前端 origin 一致。

### 9.3 可选加固：共享密钥

若设置 **`TRUSTED_SSO_SECRET`**，则除 `user_id` 外，请求必须带请求头 **`X-Trusted-Sso-Secret`** ，值与该变量一致。上游应用仍只拼 URL；密钥由**反向代理/网关**注入，适用于内网零信任加固。

### 9.4 安全与运维

- 仍依赖**办公网访问控制**；`user_id` 可能出现在浏览器历史与访问日志，建议 **HTTPS**、**审计日志**（后端已打 INFO/WARNING）。
- 须在 `users` 中预先存在对应账号（及角色）；免密不提供「自动开户」。

### 9.5 验证

```bash
# 不设 TRUSTED_SSO_SECRET 时（仅本地/内网测试）
curl -sI "http://127.0.0.1:8000/api/v1/auth/trusted-login?user_id=admin" | grep -i ^location
# 应指向 TRUSTED_SSO_FRONTEND_BASE/sso/callback#access_token=...
```

---

## 10. 相关文件索引

- SQL：`init-db/08-auth_users_roles.sql`
- 后端认证：`backend/app/api/auth.py`、`backend/app/deps/auth.py`、`backend/app/core/security.py`
- 模型：`backend/app/models/user.py`
- 前端登录与守卫：`frontend/src/app/login/page.tsx`、`frontend/src/app/sso/callback/page.tsx`、`frontend/src/components/AuthGuard.tsx`、`frontend/src/contexts/AuthContext.tsx`
- API 客户端：`frontend/src/lib/api.ts`（`authFetchInit` / `ACCESS_TOKEN_KEY`）

如有定制部署（K8s、多实例、反向代理路径），在以上基础上保证：**前端到后端的代理转发保留 `Authorization` 头**，且各实例使用**相同** `JWT_SECRET_KEY`。