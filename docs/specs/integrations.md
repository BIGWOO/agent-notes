# Agent Integration 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 Core Runtime、Optional Obsidian CLI 與 agent hook integration 的安全邊界。

---

## 整合

## Core Runtime

必要能力：

- filesystem access
- Markdown writer
- YAML frontmatter parser
- project map resolver
- Git status checker

## Optional Obsidian CLI

可選能力：

- 搜尋筆記
- 開啟產生的 note
- 檢查 backlinks
- 驗證 properties
- 讀取 active note

核心 CLI 必須能在 Obsidian 未開啟時運作。

## Agent Hooks

預計整合：

- Codex Stop hook
- OpenClaw cron 或 session summary workflow
- Claude Code hook
- 手動 shell command

所有 hooks 都應呼叫同一個 CLI，不應讓每個 agent 自己產生 Markdown 格式。

Agent Notes 不應在 `npm install`、`npx agent-notes` 或 `agent-notes init` 的預設流程中自動新增 hook。Hook 設定屬於高信任本機設定，會影響 agent 每次結束 session 的行為，因此必須採用明確授權流程。`init` 可以提供 optional integration wizard，但該 wizard 必須呼叫同一套 `integrate` engine，且沒有使用者最後確認不得寫入。

| 模式 | Command | 行為 |
| --- | --- | --- |
| Manual | `agent-notes capture ...` | 使用者或 agent 手動呼叫 CLI，不修改 agent 設定 |
| Guided | `agent-notes integrate <agent> --dry-run` | 偵測環境並預覽將寫入的 hook 設定 |
| Apply | `agent-notes integrate <agent> --apply` | 使用者明確同意後才寫入本機 hook 設定 |
| Init wizard | `agent-notes init` | 可多選 agents，逐一 dry-run，最後確認後委派 `integrate` engine 寫入 |

`init` 的 integration wizard 必須支援多選。使用者可以一次選擇 Codex、Claude Code、OpenClaw 等多個 agent，也可以選擇暫不設定。多選後仍需逐一顯示 dry-run 摘要，並在使用者確認後才套用。

`integrate` engine 必須遵守以下規則：

- 預設 read-only
- `integrate --list` 只把目前可安全套用的 agent 標為 supported；尚未支援者可顯示為 coming soon 或 unavailable
- 修改前顯示目標檔案、變更摘要與可回復方式
- 不寫入 secret、token、channel id 或私有 project map
- 不假設所有使用者的 agent config path、shell、權限或 agent 版本一致
- 寫入前建立 backup 或提供可手動套用的 patch
- 失敗時不得影響既有 agent 設定

## Phase 1 Scope

Phase 1 只支援 Codex integration 的 dry-run 與受限 apply。Claude Code 與 OpenClaw 必須顯示 `coming soon`，不得假裝成功。

| Agent | `integrate --list` | `--dry-run` | `--apply` |
| --- | --- | --- | --- |
| Codex | `supported` when config adapter recognizes local config | yes | yes, only for recognized config shape |
| Claude Code | `coming soon` | no write; show unsupported | no |
| OpenClaw | `coming soon` | no write; show unsupported | no |

## Phase 2 前段 Scope

Phase 2 前段先新增共用 adapter shape、Claude Code dry-run skeleton 與 OpenClaw workflow dry-run skeleton。此 scope 不代表 Claude Code 或 OpenClaw apply 已可用。

| Agent | `integrate --list` | `--dry-run` | `--apply` |
| --- | --- | --- | --- |
| Codex | `supported` when config adapter recognizes local config | yes | yes, only for recognized config shape |
| Claude Code | `dry-run-only` | yes, no write | no, return `INTEGRATION_UNSUPPORTED` |
| OpenClaw | `dry-run-only` | yes, no write | no, return `INTEGRATION_UNSUPPORTED` |

Claude Code dry-run output 至少包含：

- detected config summary；找不到時顯示 `not detected`
- checked config candidate basenames
- planned hook command template
- stable binary check result
- `filesToModify: 0` 與 `filesToBackup: 0`
- recovery hints

Claude Code 真實 hook schema 未 fixture-driven 驗證前，不得寫入本機設定或建立 backup。

OpenClaw dry-run output 至少包含：

- detected config/workflow summary；找不到時顯示 `not detected`
- checked config/workflow candidate basenames
- planned workflow command template
- stable binary check result
- `filesToModify: 0` 與 `filesToBackup: 0`
- recovery hints

OpenClaw 真實 workflow 或 config schema 未 fixture-driven 驗證前，不得寫入本機設定或建立 backup。

## Codex Adapter Contract

Codex adapter 應採 fixture-driven 實作，不猜測所有版本的 config path 或 hook schema。

規則：

- 可讀取 `CODEX_HOME`；未設定時使用 `~/.codex/` 作為候選 config root。
- 只有 adapter 認得的 Codex config 檔與 hook schema 才允許 `--apply`。
- 找不到 config 時回傳 `INTEGRATION_NOT_FOUND`。
- config shape 不符合已測 fixture 時，`--dry-run` 顯示 manual instructions，`--apply` 回傳 `INTEGRATION_UNSUPPORTED`。
- hook command 必須使用穩定 binary path，例如 global install path；偵測到 `npx` ephemeral path 回傳 `INTEGRATION_BINARY_UNSTABLE`。
- apply 前建立 timestamped backup；backup 失敗回傳 `BACKUP_FAILED`，不得修改原檔。

`integrate codex --dry-run` 輸出至少包含：

- safe config summary，例如 basename + short hash；不得輸出完整本機 config path
- planned hook command
- stable binary check result
- files that would be backed up
- files that would be modified
- recovery note

`integrate codex --apply` 成功條件：

- backup 已建立
- hook command 已寫入 recognized config
- 既有 unrelated config preserved
- output 顯示 backup path 與下一步 `agent-notes doctor`

## Integration Acceptance Cases

| Case | Command / Condition | Exit Code | Assertion |
| --- | --- | --- | --- |
| list without Agent Notes config | `agent-notes integrate --list` | `OK` | 不要求先 init；顯示 Codex 可偵測狀態，Claude Code / OpenClaw dry-run-only |
| codex dry-run recognized | recognized fixture config | `OK` | 不寫檔，顯示 planned patch |
| codex missing config | no Codex config | `INTEGRATION_NOT_FOUND` | 不寫檔 |
| codex unknown config shape | unrecognized fixture | `INTEGRATION_UNSUPPORTED` | 不寫檔，顯示 manual instructions |
| claude-code dry-run | optional candidate config exists or missing | `OK` | 不寫檔，顯示 hook template 與 recovery hints |
| claude-code apply unsupported | any Claude Code config state | `INTEGRATION_UNSUPPORTED` | 不寫檔，不建立 backup |
| openclaw dry-run | optional candidate config exists or missing | `OK` | 不寫檔，顯示 workflow command template 與 recovery hints |
| openclaw apply unsupported | any OpenClaw config state | `INTEGRATION_UNSUPPORTED` | 不寫檔，不建立 backup |
| unstable binary | hook would call ephemeral `npx` | `INTEGRATION_BINARY_UNSTABLE` | 不寫檔 |
| apply backup fail | backup path not writable | `BACKUP_FAILED` | 原 config 不變 |
| apply success | recognized config + stable binary | `OK` | backup exists, unrelated config preserved |
