# Win10 发布与数据库恢复：本次会话经验总结

本文档归纳本次将 **Windows 10 一键部署**、**pg_dump 引导库**、**向量扩展与编码** 等问题打通过程中的经验，便于后续少踩坑、少返工。

## 成功做法（值得保留）

1. **用真实 dump 做引导，而不是手写 init SQL 长期维护**  
   以 `db-bootstrap/` 中的快照为准，配合 `scripts/restore_bootstrap_db.py` 过滤与恢复，避免“脚本与线上结构漂移”。

2. **恢复大 SQL 走 `psql -f`，避免 asyncpg + 整文件解析**  
   大文件用 `sqlparse`/逐条执行容易触发 asyncpg 内部错误（如 `NoneType.decode`）。统一用 `psql` 流式执行更稳。

3. **针对应用角色显式跳过无权限语句**  
   过滤或跳过：`COMMENT ON EXTENSION`、`ALTER EXTENSION`、`DISABLE TRIGGER ALL`、`ENABLE TRIGGER ALL`，以及 psql 元命令 `\restrict`/`\unrestrict`，减少“超级用户才能执行”的噪声错误。

4. **向量扩展：`CREATE EXTENSION vector` 走超级用户路径**  
   通过 `--superuser-extension` 与环境变量（如 `BOOTSTRAP_SUPERUSER_EXTENSION`、`BOOTSTRAP_SUPERUSER_PASSWORD`、可选 `BOOTSTRAP_SUPERUSER_DATABASE_URL`）在恢复前/中完成扩展安装；超级用户 DSN 继承 `DATABASE_URL` 的 query（如 SSL），避免连接行为不一致。

5. **Windows 控制台与 Postgres 客户端编码**  
   批处理中 `chcp 65001`，环境 `PGCLIENTENCODING=UTF8`，减轻中文与 UTF-8 报错乱码。

6. **部署脚本分层：发布产物 + 一键全量**  
   `win10-release/` 下分步部署与 `OneClick-FullDeploy.bat`（强制 DB 重建 + 超级用户向量路径 + 启服务）降低操作者心智负担；`Publish-Win10-Artifact` + `scripts/publish_win10_artifact.py` 统一打包。

7. **DashScope / LiteLLM 嵌入参数**  
   在 `backend/app/services/litellm_kwargs.py` 等处将 `encoding_format` 规范为 API 接受的 `float`（除非明确 `base64`），避免 400：`encoding_format only support with [float, base64]`。

8. **Git 与行尾**  
   `.gitattributes` 对 `*.bat` 使用 CRLF，减少 Windows 下脚本行尾问题。

## 失败与弯路（时间与 token 花在这里）

1. **在“应用用户跑全量 dump”上反复试错**  
   未一开始就区分：哪些语句必须超级用户、哪些可以应用角色，导致权限、扩展、触发器类错误循环出现。

2. **用错误工具链执行巨型 SQL**  
   坚持用 asyncpg 拆句执行大 dump，直到出现解析/驱动层异常才切换到 `psql -f`——应更早选定 `psql` 为恢复主路径。

3. **忽略 psql 专有元命令**  
   dump 中的 `\restrict`/`\restrict` 非标准 SQL，未过滤时直接语法错误；应把“strip 元命令”作为恢复脚本的第一批规则。

4. **超级用户连接串与 SSL/参数不一致**  
   仅改用户名密码而丢失 `DATABASE_URL` 的 query 参数时，会出现连接被关闭、SSL 相关差异；应用“复制 query string”或单独提供完整 superuser URL”后问题才消失。

5. **嵌入 API 与 LiteLLM 默认参数不匹配**  
   供应商对 `encoding_format` 约束严格，默认传入非法组合导致 400；应在调用层统一归一化，而不是在业务里零散 patch。

6. **范围过大导致迭代成本高**  
   同一会话内同时改：发布流水线、多份 README、restore、LiteLLM、迁移与数据文件等，diff 大、验证路径长，容易拉长会话与 token。更优策略：**先打通最小闭环（restore + 启动）再铺文档与打包**。

## 建议的后续节奏（省时间）

- 变更拆 PR：基础设施（restore + deploy）与文档/打包分开合并。  
- 本地/CI 增加一次“从 `db-bootstrap` 恢复到空库”的冒烟脚本，避免回归。  
- 新环境检查清单：Postgres、`psql` 在 PATH、编码 UTF-8、向量扩展策略（超级用户）已配置。

## 相关路径速查

| 区域 | 路径 |
|------|------|
| Win10 发布批处理 | `win10-release/` |
| 数据库恢复 | `scripts/restore_bootstrap_db.py` |
| 引导数据快照 | `db-bootstrap/` |
| 英文/中文 Windows 说明 | `README.WINDOWS.md`, `README.WINDOWS.zh.md` |
| 发布脚本与镜像文档 | `Publish-Win10-Artifact.bat`, `scripts/publish_win10_artifact.py`, `docs/WIN10_RELEASE_CODE.md` |
| 嵌入参数 | `backend/app/services/litellm_kwargs.py` |

---

*由会话回顾整理，便于团队内部分享与 onboarding。*
