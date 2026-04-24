# Win10 发布与数据库引导：会话回顾（失败与成功经验）

本文档总结一次较长的 Win10 部署与 `pg_dump` 引导还原迭代中的**踩坑、耗时点**与**有效做法**，便于下次缩短试错与 token 消耗。

---

## 成功经验（值得复用）

### 1. 用真实 `pg_dump` 快照替代手写 init SQL

- **做法**：以 `db-bootstrap/` 中的 dump 为单一事实来源，配合过滤/跳过脚本处理权限与元命令。
- **收益**：避免“脚本与生产结构漂移”、减少手工维护；部署更可重复。

### 2. 大文件还原走 `psql -f`，而不是在应用里用 asyncpg 整文件解析

- **原因**：超大 SQL + 某些解析路径会触发 asyncpg 内部错误（例如与 decode 相关的异常）。
- **做法**：过滤后写临时文件，用 `psql -f` 执行；失败时保留临时 SQL 路径便于排障。

### 3. 针对“应用角色”显式跳过超权限语句

- **跳过/过滤**：`COMMENT ON EXTENSION`、`ALTER EXTENSION`、`DISABLE TRIGGER ALL`、`ENABLE TRIGGER ALL` 等。
- **收益**：减少 `psql` 非零退出与权限噪声，还原流程更稳定。

### 4. `vector` 扩展：超用户路径与环境变量

- **问题本质**：`CREATE EXTENSION vector` 等操作通常需要超级用户或等价权限。
- **做法**：`--superuser-extension` + `BOOTSTRAP_SUPERUSER_`* 系列环境变量；超用户 DSN 继承 `DATABASE_URL` 的查询串（如 SSL）以保持连接行为一致。
- **收益**：避免“应用用户能连库但不能建扩展”的反复试错。

### 5. 剥离 psql 元命令

- **问题**：dump 中的 `\restrict` / `\unrestrict` 等仅 psql 识别，裸执行会报语法错。
- **做法**：在导入前从 SQL 文本中剔除这些行。

### 6. 中文与编码：终端与客户端一致 UTF-8

- **做法**：批处理中 `chcp 65001`，环境 `PGCLIENTENCODING=UTF8`。
- **收益**：减少乱码掩盖真实错误信息的情况。

### 7. 部署脚本内确保 Python 依赖

- **做法**：Deploy-03 在 venv 中 `pip install -r backend/requirements.txt` 再执行还原。
- **收益**：避免“本机缺 asyncpg”等环境差一截的问题。

### 8. 嵌入模型 / LiteLLM：`encoding_format` 与厂商约束

- **问题**：DashScope 等接口对 `encoding_format` 取值敏感（例如仅支持 `float` / `base64`）。
- **做法**：在 kwargs 层对 DashScope 路径规范为安全默认值（如强制 `float`，除非明确 `base64`）。
- **收益**：消除 400 类错误与“参数看起来对却一直被拒”的消耗。

### 9. 文档与产物分层

- **做法**：`README.WINDOWS.md`（英文）与 `README.WINDOWS.zh.md`（中文）分离；`win10-release/` 一键脚本与发布脚本分工清晰。
- **收益**：用户按语言与场景取文档，减少在单文件里中英混杂造成的阅读成本。

---

## 失败与耗时点（教训）

### 1. 低估“还原管道”的权限与语句多样性

- **表现**：`CREATE EXTENSION`、extension 相关 COMMENT/ALTER、触发器批量禁用等在不同角色下行为差异大。
- **教训**：尽早列出“应用角色禁止执行的语句类别”，在过滤器里统一处理，而不是遇到一条改一条。

### 2. 用大字符串 + 库内 SQL 切分处理整库 dump

- **表现**：体积与边界情况导致解析/驱动层异常，排障成本高。
- **教训**：大数据量还原优先 **PostgreSQL 官方工具链（psql）**，应用内仅做编排与前置过滤。

### 3. SSL / 连接参数在“双 DSN”（应用用户 vs 超用户）上不一致

- **表现**：一端能连、一端 `connection was closed` 或 SSL 相关失败。
- **教训**：超用户 URL 应复用与 `DATABASE_URL` 相同的 query 参数策略，或提供单独的完整超用户 URL 并做校验。

### 4. 错误信息被编码问题污染

- **表现**：中文乱码时难以判断是 SQL 错还是权限错。
- **教训**：先固定终端与 `PGCLIENTENCODING`，再读错误；必要时把 stderr 重定向到 UTF-8 文件查看。

### 5. 旧脚本与一键入口并存导致路径混淆

- **表现**：用户可能仍运行已废弃的 `package_win10.bat` / `run_win10_oneclick.bat` 等。
- **教训**：废弃脚本应明确 stub（提示 + 退出），主入口集中到 `win10-release/`，文档只指向新入口。

### 6. 外部 API（嵌入）参数“隐式默认”与文档不一致

- **表现**：本地以为合法的 `encoding_format` 被服务端拒绝。
- **教训**：对第三方 API 做**显式规范化**（在调用前强制允许集合），并在日志中打印最终请求关键字段（注意脱敏）。

---

## 下次如何省时间（检查清单）

1. **还原前**：确认 Postgres、`psql` 在 PATH；`DATABASE_URL` 与（如需）超用户变量已就绪。
2. **编码**：Win 控制台 UTF-8 + `PGCLIENTENCODING=UTF8`。
3. **扩展**：若需 `vector`，提前走超用户扩展路径，避免在应用用户阶段才失败。
4. **执行方式**：大 dump → 过滤 → `psql -f`；失败保留临时 SQL。
5. **入口**：只宣传 `win10-release/OneClick-FullDeploy.bat`（或文档列出的当前主流程）。
6. **嵌入**：变更模型供应商时，先对照其当前 API 对 `encoding_format`、维度等硬约束。

---

## 相关路径（便于跳转）


| 用途                        | 路径                                                          |
| ------------------------- | ----------------------------------------------------------- |
| Win10 一键与分步部署             | `win10-release/`                                            |
| 数据库引导/过滤还原                | `scripts/restore_bootstrap_db.py`                           |
| Windows 说明（英文）            | `README.WINDOWS.md`                                         |
| Windows 说明（中文）            | `README.WINDOWS.zh.md`                                      |
| 发布产物脚本                    | `scripts/publish_win10_artifact.py`                         |
| Cursor Agent Skill + 使用说明 | `.cursor/skills/win10-pg-bootstrap/`（`SKILL.md`、`USAGE.md`） |


---

*本文件为过程回顾，不替代正式发布说明；部署以当前仓库内 README 与脚本为准。*