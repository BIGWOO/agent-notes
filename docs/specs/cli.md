# CLI Command 規格

Status: implementation-ready for Phase 1 draft
Last Updated: 2026-06-06
Source: Phase 1 implementation planning

本檔定義 Phase 1 CLI command contract。目標是讓 MVP 先可用、可測試、可回復；post-MVP command 只保留邊界，不在 Phase 1 實作。

---

## Common Contract

Phase 1 所有 command 需遵守同一組基本行為：

- 預設輸出人類可讀文字，測試以 exit code 與檔案結果為準。
- `--dry-run` 不寫任何檔案，只列出將讀取、建立、修改或略過的 path。
- `--dry-run` 輸出中的 tracked vault path 必須是 vault-relative；本機絕對 repo path、home path、agent config path 預設需 redacted，只能顯示 basename、short hash 或用途說明。
- 會寫檔的 command 必須先載入 config、驗證 vault、取得必要 lock，並在寫入前做 backup 或 atomic write。
- 任何 command 都不得把本機絕對 repo path、vault path、project map path 寫入 tracked Markdown。
- 找不到 config 時，除 `init`、`integrate --list`、`--help`、`--version` 外一律回傳 `CONFIG_NOT_FOUND`。
- 讀到 post-MVP config，例如 `sharing.mode=team`，Phase 1 一律回傳 `FEATURE_UNSUPPORTED`。
- `--help` 與 `--version` 不需要 config。
- 未分類錯誤回傳 `UNKNOWN_ERROR`，但實作應盡量映射到 [`error-codes.md`](error-codes.md) 的穩定錯誤碼。

## Phase 1 Commands

| Command | Required | Optional | Writes | Main Errors |
| --- | --- | --- | --- | --- |
| `init` | none | `--yes`、`--lang`、`--vault-path`、`--no-integrations`、`--no-project`、`--project-repo`、`--allow-git-worktree-vault`、`--resume`、`--rollback`、`--dry-run` | local config、project map、vault skeleton、templates、optional integrations | `PATH_INVALID`、`PATH_UNSAFE`、`VAULT_EXISTS_NON_EMPTY`、`INIT_PARTIAL` |
| `project add` | `--repo` | `--name`、`--project-id`、`--dry-run` | project map、project context templates | `PROJECT_MAP_INVALID`、`PATH_INVALID`、`WRITE_CONFLICT` |
| `project list` | none | `--repo` | none | `CONFIG_NOT_FOUND`、`PROJECT_MAP_INVALID` |
| `project check` | none | `--repo` | none | `PROJECT_NOT_FOUND`、`PROJECT_MAP_INVALID` |
| `capture` | `--summary-file` except `--scope ignore` | `--repo`、`--tool`、`--scope`、`--visibility`、`--source-file`、`--dry-run` | session card、source index、provenance log、optional marker blocks | `INVALID_SUMMARY_FILE`、`PROJECT_NOT_FOUND`、`PRIVATE_DATA_RISK`、`WRITE_CONFLICT` |
| `context` | `--repo` | `--max-chars` | none | `PROJECT_NOT_FOUND`、`PROJECT_MAP_INVALID` |
| `doctor` | none | `--check`、`--json` | none in Phase 1 | `CONFIG_INVALID`、`VAULT_NOT_FOUND`、`PRIVATE_DATA_RISK`、`PROVENANCE_ORPHAN` |
| `trace` | positional `id` | `--json` | none | `TRACE_TARGET_NOT_FOUND`、`SOURCE_NOT_FOUND`、`PROVENANCE_ORPHAN` |
| `integrate --list` | none | none | none | none |
| `integrate codex --dry-run` | none | `--binary` | none | `INTEGRATION_NOT_FOUND`、`INTEGRATION_BINARY_UNSTABLE` |
| `integrate codex --apply` | none | `--binary`、`--yes` | Codex local hook config backup + patch | `INTEGRATION_APPLY_FAILED`、`INTEGRATION_BINARY_UNSTABLE` |

## Command Details

### `agent-notes init`

`init` 是唯一可在沒有 config 時執行的 setup command。完整 onboarding 規則見 [`init-onboarding.md`](init-onboarding.md)。

Phase 1 `init` 的完成條件：

- 建立新的標準 Agent Notes vault，不採用既有 Obsidian vault。
- 建立 local config 與 empty project map。
- 建立 vault `.gitignore`，至少忽略 `private/`、`.agent-notes/`、`.DS_Store`。
- 建立 `00-Meta/Systems/agent-note-protocol.md`、`06-Templates/` 與 project context templates。
- 非互動模式缺必要 flags 時回傳 `NON_INTERACTIVE_REQUIRED`。
- `--dry-run` 顯示 plan，不建立任何檔案。

### `agent-notes project add --repo <path>`

`project add` 把 repo 綁定到 personal vault 的 local project map。

規則：

- `<path>` 必須 canonicalize，並確認可讀。
- 若 `<path>` 是 Git repo，`repoId` 預設用 repo root basename slug。
- `projectId` 預設等於 `repoId`，若衝突則加短 suffix。
- `notePath` 預設為 `03-Projects/<Project Name>`，必須是 vault 相對路徑。
- 若 project 已存在且 repo path 已綁定，command idempotent，回傳 `OK` 並顯示 existing entry。
- 不把絕對 repo path 寫入 Markdown，只寫 local project map。
- `--dry-run` 顯示 project map entry、project context template paths 與會建立的目錄，不寫檔。
- `--dry-run` 不得輸出 repo 絕對路徑；repo path 只能顯示 basename、`repoId` 與可重現的 short hash。

### `agent-notes project list`

`project list` 是 read-only command，用來讓使用者與 agent 確認目前 vault 已知的 projects。

規則：

- 載入 config 與 project map；project map schema 無效時回 `PROJECT_MAP_INVALID`。
- 預設輸出 `projectId`、`name`、`repoId`、`notePath`、`visibility`。
- 不輸出 `repoPaths` 的絕對路徑；若需要除錯，應由 `doctor --check project-map` 顯示本機風險摘要。
- `project list --repo <path>` 會先 canonicalize repo path，並在輸出中標示 matched project；找不到時仍回 `OK`，但顯示 `matched: none` 與 `project add` 提示。
- project map 為空時回 `OK`，顯示 empty state 與 `agent-notes project add --repo "$PWD"` 範例。

### `agent-notes project check`

`project check` 是 read-only command，用來驗證某個 repo 是否能解析到 project。

規則：

- 未提供 `--repo` 時使用目前工作目錄。
- `<path>` 必須 canonicalize；路徑不存在或不可讀回 `PATH_INVALID`。
- repo path 對應到 project map 時回 `OK`，輸出 `projectId`、`repoId`、`notePath`。
- 找不到 project 時回 `PROJECT_NOT_FOUND`，不得自動建立 project map entry。
- 若 project entry 的 `notePath` 不是 vault-relative path，回 `PROJECT_MAP_INVALID`。

### `agent-notes capture`

`capture` 是 Phase 1 核心寫入 command。它只接受 deterministic summary file，不解析完整 transcript。

最小成功流程：

1. 載入 config 與 project map。
2. 驗證 `--summary-file` headings 與 `Summary`。
3. 依 `--scope` 與 `--repo` 決定目的地。
4. 建立 opaque `sourceRef`。
5. 準備 session card、source index、provenance log 與 marker block diff。
6. 對最終將寫入的 frontmatter、body 與 marker diff 執行 public-safe gating；`team-safe` 或 `public-safe` 失敗時停止，不寫檔。
7. 在同一 write batch 內寫入 session card、source index、provenance log 與 marker blocks；若 marker item 無法同時保留 provenance，該 marker update 必須 abort。

`--scope` 行為：

| Scope | Destination | Project Required | Marker Update |
| --- | --- | --- | --- |
| `ignore` | none | no | no |
| `inbox` | `01-Inbox/` | no | no |
| `daily` | `02-Daily/` | no | no |
| `area` | `04-Areas/` | no | no |
| `personal` | `00-Meta/Personal/` | no | no |
| `project` | project note path | yes | yes |

未提供 `--scope` 時：

- `--repo` 可解析到 project 時，使用 `project`。
- `--repo` 無法解析時，使用 `inbox` 並提示 `project add`。
- 未提供 `--repo` 時，使用 `inbox`。

Phase 1 不支援 raw transcript copy。`--source-file` 只建立 local pointer；`--include-raw` 保留給 post-MVP，Phase 1 呼叫時回傳 `FEATURE_UNSUPPORTED`。

### `agent-notes context --repo <path>`

`context` 只讀取 personal vault 與 project map，輸出給 agent 開工前使用的 context packet。

輸出內容優先順序：

1. project README generated summary
2. active tasks
3. recent decisions
4. pitfalls
5. recent sessions

規則：

- 預設 size bound 為 12000 characters，`--max-chars` 可調整本次輸出上限。
- 不讀取 `private/`、`.agent-notes/` 或 raw transcript。
- 找不到 project 時回傳 `PROJECT_NOT_FOUND`。
- 詳細 packet contract 見 [`../architecture/context-pipeline.md`](../architecture/context-pipeline.md)。

### `agent-notes doctor`

`doctor` 是安全檢查 command。Phase 1 預設不自動修復，只列出狀態與建議。

Phase 1 checks：

| Check | Reads | Blocking Code | Notes |
| --- | --- | --- | --- |
| `config` | local config | `CONFIG_NOT_FOUND` / `CONFIG_INVALID` | `--check config` 只跑此項 |
| `vault` | vault root、`.gitignore`、required dirs | `VAULT_NOT_FOUND` / `VAULT_NOT_WRITABLE` / `INIT_PARTIAL` / `PRIVATE_DATA_RISK` | 確認 `private/`、`.agent-notes/` 被 ignore |
| `project-map` | local project map | `PROJECT_MAP_INVALID` | note path 必須 vault-relative |
| `templates` | `06-Templates/`、protocol file | `CONFIG_INVALID` | Phase 1 只檢查存在與最小 headings |
| `markers` | project context files | `MARKER_INVALID` / `PROVENANCE_ORPHAN` | marker 格式錯誤或 generated item 缺來源 |
| `provenance` | `.agent-notes/source-index.json`、`.agent-notes/provenance.jsonl`、session cards | `SOURCE_NOT_FOUND` / `PROVENANCE_ORPHAN` | sourceRef、sessionId、itemId 必須互相可追溯 |
| `public-safe` | tracked Markdown only | `PRIVATE_DATA_RISK` | heuristic scan，不宣稱能證明完全無敏感資訊 |
| `integrations` | supported agent local config | `INTEGRATION_NOT_FOUND` / `INTEGRATION_UNSUPPORTED` | 不寫 hook；只顯示狀態 |

輸出規則：

- 預設輸出人類可讀 summary；`--json` 輸出 `{ status, checks: [{ name, status, code, message, paths }] }`。
- 若多個 check 失敗，process exit 使用最優先的 blocking code，並在輸出列出全部 failures。
- `--check <name>` 只跑單一 check；不支援的 check name 回 `FEATURE_UNSUPPORTED`。
- Phase 1 `doctor` 不自動修復，不建立缺少的檔案；修復流程由使用者明確呼叫 `init --resume`、`project add` 或重新 capture。

### `agent-notes trace <id>`

`trace` 用來回溯 `itemId`、`sessionId` 或 `sourceRef`。

輸出需包含：

- resolved target type
- session id 與 note path
- sourceRefs
- provenance entries
- 若可用，source index 中的 local pointer summary

不得把 local pointer 寫入 tracked Markdown。

查找順序：

1. 若 id 符合 `src_` 前綴，先查 `.agent-notes/source-index.json`。
2. 若 id 符合 session id，先查 session card frontmatter，再查 provenance log。
3. 若 id 符合 generated item id，先查 `.agent-notes/provenance.jsonl`，再查 tracked marker blocks / session cards fallback。
4. Phase 1 personal mode 找不到 source ref 時回 `SOURCE_NOT_FOUND`。
5. 找不到 item 或 session 時回 `TRACE_TARGET_NOT_FOUND`。
6. 找到 item 但缺 session、sourceRefs 或 provenance chain 時回 `PROVENANCE_ORPHAN`。

輸出規則：

- 預設輸出人類可讀 trace summary；`--json` 輸出 `{ target, sessions, sourceRefs, provenance, warnings }`。
- local source path 只能顯示在 terminal output，不得由 `trace` 寫回任何 tracked Markdown。
- 若 source index 有 `contentHash`，可顯示 hash；若 local source file 不存在，trace 仍可回 `OK` 但需加 warning `local source missing`。

### `agent-notes integrate`

Phase 1 只承諾 Codex integration；Claude Code 與 OpenClaw 可顯示 `coming soon`。

規則：

- `integrate --list` 不寫檔。
- `integrate codex --dry-run` 顯示會修改的本機 agent config、backup path 與 hook command。
- `integrate codex --apply` 必須先 backup，並在使用者確認或 `--yes` 後才套用。
- hook command 必須引用穩定 binary path；偵測到 ephemeral `npx` path 時回傳 `INTEGRATION_BINARY_UNSTABLE`。

## Post-MVP Commands

`rollup`、`classify`、`sync`、`promote`、`publish` 不屬於 Phase 1。若使用者在 Phase 1 呼叫，CLI 應回傳 `FEATURE_UNSUPPORTED`，並顯示 roadmap 階段。
