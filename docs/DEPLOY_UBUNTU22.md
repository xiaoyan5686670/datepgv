# 在 Ubuntu 22.04 上部署 datepgv（Docker）

本文说明如何将本仓库打包后部署到 **Ubuntu 22.04**（无 Kubernetes，仅 Docker Compose）。

## 1. 在开发机打包

在仓库根目录执行：

```bash
chmod +x scripts/package-for-ubuntu.sh
bash scripts/package-for-ubuntu.sh
```

会生成 `datepgv-ubuntu-YYYYMMDD-HHMMSS.tar.gz`（不含 `.git`、`node_modules`、`.next`、`.env` 等）。

将压缩包拷到服务器，例如：

```bash
scp datepgv-ubuntu-*.tar.gz youruser@your-server:/opt/
```

## 2. 服务器准备（Ubuntu 22.04）

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Docker Engine + Compose 插件（官方仓库）
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"
# 重新登录后 docker 无需 sudo
```

防火墙（若启用 ufw）放行 Web/API/DB（按需要缩小暴露面，生产可仅开放 80/443 由反代转发）：

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 8000/tcp
sudo ufw allow 5432/tcp
```

生产建议：**不要对外暴露 5432**，仅用内网或 `127.0.0.1` 访问数据库。

## 3. 解压与配置

```bash
cd /opt
sudo mkdir -p datepgv
sudo tar -xzf datepgv-ubuntu-*.tar.gz -C datepgv
sudo chown -R "$USER:$USER" /opt/datepgv
cd /opt/datepgv

cp .env.example .env
nano .env   # 至少配置 LLM / 嵌入、JWT_SECRET_KEY（生产必填）等，见主 README
```

将 `.env` 中的 `DATABASE_URL` 保持为 `postgresql+asyncpg://...@localhost:5432/...` 亦可；**使用 `docker-compose.ubuntu.yml` 时，Compose 会为 backend 容器覆盖为指向 `postgres` 服务的地址**，与宿主机 `localhost` 填写无关。

## 4. 启动（生产镜像）

首次启动会构建前端生产镜像（`npm run build`）与后端镜像，可能需要数分钟。

```bash
cd /opt/datepgv
docker compose -f docker-compose.ubuntu.yml up -d --build
```

查看状态：

```bash
docker compose -f docker-compose.ubuntu.yml ps
docker compose -f docker-compose.ubuntu.yml logs -f --tail=100
```

（若复制命令，注意文件名是 `docker-compose.ubuntu.yml`。）

默认访问：

- 前端：http://服务器IP:3000  
- API 文档：http://服务器IP:8000/docs  
- PostgreSQL：容器名 `datepgv-postgres`，数据卷 `postgres_data`

## 5. 升级与回滚

```bash
cd /opt/datepgv
docker compose -f docker-compose.ubuntu.yml pull   # 若改用托管镜像可 pull
docker compose -f docker-compose.ubuntu.yml up -d --build
```

数据库 schema 变更请按仓库内 `init-db/` 与 [DEPLOY_AND_AUTH_MIGRATION.md](./DEPLOY_AND_AUTH_MIGRATION.md) 手动执行迁移脚本（已有数据时勿随意 `down -v`）。

## 6. 图数据库 POC（可选）

Apache AGE 测试栈在 `graph-poc/` 下，与主应用独立：

```bash
cd /opt/datepgv/graph-poc
docker compose -f docker-compose-age.yml up -d
```

避免与主栈同时占用宿主机 **5432**：主应用已占用时，请修改 `graph-poc/docker-compose-age.yml` 中 `postgres-age` 的端口映射（例如 `"5433:5432"`），并在 `age_poc_query.py` 中把端口改为 `5433`。

## 7. 与「仅开发」compose 的区别

根目录 `docker-compose.yml` 假设 PostgreSQL 跑在宿主机（如 Mac Homebrew），容器通过 `host.docker.internal` 连接。  
**Ubuntu 生产部署请使用 `docker-compose.ubuntu.yml`**，在同一 Compose 中启动 `pgvector` 与前后端，避免网络与环境不一致。
