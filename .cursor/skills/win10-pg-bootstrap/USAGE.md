# 使用说明：`win10-pg-bootstrap` Skill

本 Skill 把 `docs/WIN10_SESSION_RETROSPECTIVE.md` 里的经验压缩成 Agent 可执行的约束与检查清单，用于 **datepgv** 的 Windows 部署、`pg_dump` 引导还原、`vector` 超用户路径、编码与 LiteLLM 嵌入参数等问题。

---

## Skill 所在位置

```
.cursor/skills/win10-pg-bootstrap/
├── SKILL.md      # Agent 读取的主说明（含 frontmatter）
├── reference.md  # 路径表、环境变量、扩展清单
└── USAGE.md      # 本文件：给人看的用法说明
```

Skill **随仓库走**：克隆本仓库的同事会自动带上同一套说明。

---

## 在 Cursor 里如何生效

1. **项目级 Skill**：Cursor 会加载当前工作区 `.cursor/skills/` 下各子目录中的 `SKILL.md`（具体以你使用的 Cursor 版本为准；若设置里有 Skills / Rules 相关选项，保持项目根为 `datepgv` 即可）。
2. **触发方式**：
   - **自动**：当你在对话里提到 Win10 部署、`restore_bootstrap_db`、`db-bootstrap`、`BOOTSTRAP_SUPERUSER`、`encoding_format` 等关键词时，Agent 会参考 `SKILL.md` 的 `description` 决定是否采用本 Skill。
   - **手动**：在聊天里写清楚，例如：「按项目里的 **win10-pg-bootstrap** skill 处理」或「遵循 `.cursor/skills/win10-pg-bootstrap` 的还原流程」。

若你发现 Agent 没有带上这些约束，可直接 **@ 引用** `SKILL.md` 或把其中「Restore pipeline」一节粘贴到对话里。

---

## 你什么时候该提醒 Agent 用这个 Skill

| 场景 | 建议 |
|------|------|
| 修改 `win10-release/*.bat` 或一键部署流程 | 使用本 Skill，避免旧入口与编码/依赖遗漏 |
| 改 `scripts/restore_bootstrap_db.py` 或导入逻辑 | 使用本 Skill，避免改回 asyncpg 整文件解析或漏过滤语句 |
| `CREATE EXTENSION vector` / 权限 / 双 DSN SSL | 使用本 Skill，强调超用户路径与 DSN query 一致 |
| Windows 下中文乱码、psql 报错看不清 | 使用本 Skill，先 UTF-8 / `PGCLIENTENCODING` |
| DashScope / LiteLLM 嵌入 400、`encoding_format` | 使用本 Skill，在 kwargs 层显式规范化 |

---

## 与回顾文档的关系

| 文档 | 作用 |
|------|------|
| `docs/WIN10_SESSION_RETROSPECTIVE.md` | 完整叙事：成功/失败原因、教训，适合人读 |
| `.cursor/skills/win10-pg-bootstrap/SKILL.md` | 精简操作级规则，适合 Agent 执行时加载 |
| `reference.md` | 路径与变量速查，Agent 可按需展开阅读 |

部署的**权威步骤**仍以仓库根目录的 `README.WINDOWS*.md` 与 `win10-release/` 内脚本为准；Skill 不负责替代官方 README。

---

## 维护建议

- 还原逻辑新增了一类「应用角色必失败」的 SQL 时：更新 **`scripts/restore_bootstrap_db.py`**，并在 **`SKILL.md`** 的 “Skip” 列表或 **`reference.md`** 里补一条，避免只在聊天里口口相传。
- 更换 Windows 一键入口文件名时：同步 **`SKILL.md`** 与 **`README.WINDOWS*.md`**，并对旧脚本保持 stub。

---

## 个人全局 Skill（可选）

若希望在**所有项目**里复用同一套内容，可将 `win10-pg-bootstrap` 目录复制到本机：

`~/.cursor/skills/win10-pg-bootstrap/`

（请勿写入 `~/.cursor/skills-cursor/`，该目录由 Cursor 内置 Skill 占用。）

复制后名称与 `SKILL.md` 内 `name: win10-pg-bootstrap` 保持一致即可。
