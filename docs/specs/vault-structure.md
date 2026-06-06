# Vault 結構與隱私邊界

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 Obsidian-compatible vault 的資料夾結構、分類策略，以及 public/private repo 邊界。

---

## 資訊架構

建議 vault 結構：

```text
.gitignore
00-Meta/
  Systems/
    agent-note-protocol.md
    project-map.example.json
    source-manifest.md              # Phase 4 optional
    provenance-manifest.md          # Phase 4 optional
    team-project-catalog.example.json # Phase 4 optional
01-Inbox/
  shared-capture/
02-Daily/
03-Projects/
  <project>/
    03-context/
      README.md
      active-tasks.md
      decision-log.md
      pitfalls.md
    04-sessions/
04-Areas/
05-Resources/
06-Templates/
07-Archives/
private/
  raw-sessions/
```

新 vault 的 `.gitignore` 必須至少排除 `private/` 與 `.agent-notes/`。`private/raw-sessions/` 只在使用者明確啟用 `--include-raw` 時使用，且應被 vault `.gitignore`、`doctor` 與文件明確標示為不應公開同步的私密資料。

## 分類策略

Agent Notes 寫入前應先分類內容：

```yaml
type: chat | qa | idea | learning | decision | task | incident | session
scope: ignore | daily | inbox | area | personal | project
promote: false
confidence: 0.0
```

預設行為：

- 純閒聊：ignore 或 daily one-liner
- 一般問答：daily；若可重複使用則進 area
- 有用但不確定分類：inbox
- 可複用技術經驗：area
- repo、專案、客戶或 campaign-specific task：project
- 長期使用者偏好：personal 或 system note
- `promote` v0.1 預設一律為 `false`
- post-MVP 只有在 session 為 `team-safe`、存在 team target binding、具備 sourceRefs 且通過 privacy scan 時，才可把 `promote` 視為 promotion candidate；它不代表自動 merge 到 Team Vault main

v0.1 分類規則必須 deterministic：

- 不使用 hosted LLM 或 local LLM 自動分類
- 使用者明確提供 `--scope` 時以該值為準
- `--repo` 能解析到 project map 時，預設為 `project`
- `--repo` 無法解析時，預設寫入 `inbox`
- `confidence` 只記錄 deterministic routing 的信心，不代表模型判斷
- LLM-assisted classification 放到 post-MVP，且必須先處理隱私與 redaction

## 隱私與 Repo 策略

公開 repo 放：

- README
- public-safe PRD
- public templates
- sample project map
- generic hook examples
- generic docs

私有 repo 或本機私有分支放：

- internal PRD
- 真實 project map
- 公司特定 channel mappings
- 敏感 runbook
- 客戶名稱或私有商業情境

重要規則：檔案一旦 commit 並 push 到公開 GitHub repo，就視為公開。Git 不支援在同一個 public repo 內做 per-file privacy。

建議配置：

```text
agent-notes/                 public repo
agent-notes-private/         private repo
~/.config/agent-notes/       local config and secrets
```
