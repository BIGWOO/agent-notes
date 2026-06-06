# 使用情境模擬矩陣

Status: draft
Last Updated: 2026-06-06
Source: Phase 1 planning validation

本檔用來反覆模擬使用者與 agent 的實際操作，檢查規格是否覆蓋常見路徑、錯誤路徑與容易混淆的 onboarding 卡點。每次補規格或實作後，都應回到本矩陣檢查是否需要新增案例。

---

## Validation Rules

- 優先驗證 Phase 1 personal/local-only workflow。
- Team Vault、promotion、publish 只檢查是否被清楚拒絕或標示 post-MVP。
- 每個情境都要有 command/steps、exit code、寫入範圍、不得寫入範圍與 assertions。
- 避免為罕見 edge case 設計過度複雜流程；能用清楚錯誤碼與人工處理說明解決者，不做自動修復。

## Init / Onboarding

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-INIT-001 | 小白用戶用 `npx` 第一次執行 | `npx agent-notes@latest init` then cancel at first prompt | `INIT_CANCELLED` | none | agent hook config | 進入語言選擇；取消時不寫 hooks | [`init-onboarding.md`](../specs/init-onboarding.md) |
| S-INIT-002 | 台灣 locale | `LANG=zh_TW.UTF-8 agent-notes init` then cancel at first prompt | `INIT_CANCELLED` | none | none | `繁體中文` 排第一或預選；取消不寫檔 | [`init-onboarding.md`](../specs/init-onboarding.md) |
| S-INIT-003 | headless server 沒有 Documents | `agent-notes init --yes --lang en --no-integrations --no-project` | `NON_INTERACTIVE_REQUIRED` | none | cwd | 缺 `--vault-path` 不猜路徑 | [`cli.md`](../specs/cli.md) |
| S-INIT-004 | 預設路徑已存在且非空 | target `~/Documents/Agent-Notes/` 已有非 Agent Notes 檔案 | `VAULT_EXISTS_NON_EMPTY` | none | target dir | 建議 `Agent-Notes-2` | [`init-onboarding.md`](../specs/init-onboarding.md) |
| S-INIT-005 | 目標是既有 valid Agent Notes vault 但 local config 未指向 | `agent-notes init --vault-path <existing>` | `VAULT_ALREADY_INITIALIZED` | none | existing vault | MVP 不採用、不綁定 | [`init-onboarding.md`](../specs/init-onboarding.md) |
| S-INIT-006 | 中途失敗後 resume | failed init then `agent-notes init --resume` | `OK` | pending planned files only | tracked private data | 從 local config dir `init-state.json` 恢復並完成剩餘 write plan | [`init-onboarding.md`](../specs/init-onboarding.md) |
| S-INIT-007 | 目標在一般 Git worktree 內 | `agent-notes init --vault-path ./Agent-Notes --yes` | `PATH_UNSAFE` | none | worktree target | 非互動預設拒絕 | [`init-onboarding.md`](../specs/init-onboarding.md) |

## Project / Capture / Context

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-CAP-001 | 新增第一個專案 | `agent-notes project add --repo "$PWD"` | `OK` | project map、project context templates | tracked absolute repo path | project id/repo id/note path deterministic | [`cli.md`](../specs/cli.md) |
| S-CAP-002 | agent 完成工作後 capture | `agent-notes capture --repo "$PWD" --tool codex --scope project --summary-file agent-summary.md` | `OK` | session card、source index、provenance log、marker blocks | raw transcript、absolute path in Markdown | session/sourceRefs/derived items 可 trace | [`cli.md`](../specs/cli.md) |
| S-CAP-003 | summary file 缺 `Summary` | capture with invalid file | `INVALID_SUMMARY_FILE` | none | session card | 不寫任何輸出檔 | [`schemas.md`](../specs/schemas.md) |
| S-CAP-004 | repo 未加入 project map | `agent-notes capture --repo "$PWD" --summary-file agent-summary.md` without scope | `OK` | inbox session card、source index、provenance log | project marker blocks | 提示 `project add` | [`cli.md`](../specs/cli.md) |
| S-CAP-005 | 明確 scope project 但 repo 無法解析 | `--scope project --repo <unknown>` | `PROJECT_NOT_FOUND` | none | session card | 不 fallback inbox | [`cli.md`](../specs/cli.md) |
| S-CAP-006 | dry-run capture | `agent-notes capture ... --dry-run` | `OK` | none | all target files | 顯示預計檔案與 diff | [`cli.md`](../specs/cli.md) |
| S-CAP-007 | context 開工前讀取 | `agent-notes context --repo "$PWD"` | `OK` | none | raw/private dirs | 輸出 bounded context packet | [`cli.md`](../specs/cli.md) |
| S-CAP-008 | team-safe 含本機路徑 | summary body contains `/Users/example` with `--visibility team-safe` | `PRIVATE_DATA_RISK` | none | session card、marker blocks | public-safe gate 阻擋寫入 | [`schemas.md`](../specs/schemas.md#public-safe-gating) |
| S-CAP-009 | raw transcript opt-in | `agent-notes capture ... --include-raw` | `FEATURE_UNSUPPORTED` | none | raw copy | Phase 1 不支援 raw copy | [`cli.md`](../specs/cli.md) |

## Context

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-CTX-001 | 已加入 project 的 repo 輸出 context | `agent-notes context --repo "$PWD"` | `OK` | none | raw/private dirs、tracked Markdown | section 順序固定；Project Summary 含 CTX item、session、sourceRefs | [`context-pipeline.md`](../architecture/context-pipeline.md) |
| S-CTX-002 | context 指向未知 repo | `agent-notes context --repo <unknown>` | `PROJECT_NOT_FOUND` | none | inbox session、project map | 不 fallback 到其他 project；提示 `project add` | [`cli.md`](../specs/cli.md) |
| S-CTX-003 | context 輸出上限 | `agent-notes context --repo "$PWD" --max-chars 4000` | `OK` | none | raw/private dirs | output 不超過 max chars；被截短 section 顯示 omitted count | [`context-pipeline.md`](../architecture/context-pipeline.md) |
| S-CTX-004 | project context 缺 marker | delete active-tasks marker then `context` | `OK` | none | template auto-repair | 對應 section 顯示 `unavailable: marker missing`；不自動修檔 | [`context-pipeline.md`](../architecture/context-pipeline.md) |

## Doctor

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-DOC-001 | 健康 personal vault | `agent-notes doctor` | `OK` | none | any config/vault files | checks summary 全部 pass 或 info | [`cli.md`](../specs/cli.md) |
| S-DOC-002 | 找不到 config | remove local config then `agent-notes doctor` | `CONFIG_NOT_FOUND` | none | new config | 不自動 init；提示 `agent-notes init` | [`cli.md`](../specs/cli.md) |
| S-DOC-003 | vault `.gitignore` 未忽略 private paths | remove `.agent-notes/` ignore then `doctor --check vault` | `PRIVATE_DATA_RISK` | none | `.gitignore` | 回報缺少 ignore pattern；不自動修復 | [`cli.md`](../specs/cli.md) |
| S-DOC-004 | tracked Markdown 含 private pattern | note contains `.env` secret-like string then `doctor --check public-safe` | `PRIVATE_DATA_RISK` | none | note rewrite | 回報 path 與 pattern 類型，不輸出完整 secret | [`cli.md`](../specs/cli.md) |
| S-DOC-005 | marker item 缺 sourceRefs | generated item lacks sourceRefs | `PROVENANCE_ORPHAN` | none | marker rewrite | 不把無來源 item 視為健康 | [`provenance.md`](../specs/provenance.md) |

## Trace

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-TRACE-001 | trace decision id | `agent-notes trace DEC-0001` | `OK` | none | tracked Markdown | 回傳 item type、session、notePath、sourceRefs、derivedFrom | [`provenance.md`](../specs/provenance.md) |
| S-TRACE-002 | trace source ref | `agent-notes trace src_20260606_codex_001` | `OK` | none | tracked Markdown | 回傳 sessions、tool、capturedAt、hash/warning；不寫入 local path | [`provenance.md`](../specs/provenance.md) |
| S-TRACE-003 | trace 不存在 item | `agent-notes trace DEC-9999` | `TRACE_TARGET_NOT_FOUND` | none | logs with private path | 不猜相近 id，不掃 raw transcript | [`cli.md`](../specs/cli.md) |
| S-TRACE-004 | source index 缺 source ref | remove source index entry then trace existing item | `PROVENANCE_ORPHAN` | none | source index repair | item 存在但來源鏈斷裂，回 blocking code 並提示 doctor | [`provenance.md`](../specs/provenance.md) |

## Marker / Provenance

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-MARK-001 | marker 外有人類筆記 | capture updates active tasks | `OK` | marker block、provenance log | marker 外內容 | marker 外 byte-for-byte preserved | [`marker-blocks.md`](../specs/marker-blocks.md) |
| S-MARK-002 | marker block 缺 end | capture updates project context | `MARKER_INVALID` | none after rollback | partial marker item | 檔案內容維持原狀 | [`marker-blocks.md`](../specs/marker-blocks.md) |
| S-MARK-003 | 既有 item 追加新來源 | repeat capture with same fingerprint and new sourceRef | `OK` | marker block、provenance log | duplicate item id | 保留 item id，不產生重複決策 | [`marker-blocks.md`](../specs/marker-blocks.md) |
| S-MARK-004 | sourceRefs orphan | marker item lacks sourceRefs | `PROVENANCE_ORPHAN` | none | marker item | 無來源 item 不得寫入 | [`provenance.md`](../specs/provenance.md) |
| S-MARK-005 | provenance append failure | simulate provenance write conflict | `WRITE_CONFLICT` | no net writes after rollback | marker without provenance | 最終不得有 marker item 缺 provenance | [`marker-blocks.md`](../specs/marker-blocks.md) |

## Integration

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-INT-001 | list 不需 Agent Notes config | `agent-notes integrate --list` before init | `OK` | none | local config、hook config | Codex 可偵測狀態可讀；Claude/OpenClaw coming soon | [`integrations.md`](../specs/integrations.md) |
| S-INT-002 | Codex dry-run recognized config | `agent-notes integrate codex --dry-run --binary <stable>` | `OK` | none | hook config | 顯示 planned patch、backup path、hook command | [`integrations.md`](../specs/integrations.md) |
| S-INT-003 | Codex dry-run unknown config shape | `agent-notes integrate codex --dry-run` with unrecognized fixture | `INTEGRATION_UNSUPPORTED` | none | hook config | 顯示 manual instructions，不假裝成功 | [`integrations.md`](../specs/integrations.md) |
| S-INT-004 | init 多選 integrations | 選 Codex + Claude Code，Codex dry-run confirmed | `OK` | Codex config only after confirmation | Claude config if unsupported | Codex 可 apply；Claude coming soon 不阻塞，輸出每個 agent 的結果摘要 | [`integrations.md`](../specs/integrations.md) |
| S-INT-005 | npx ephemeral path | `integrate codex --apply` with ephemeral binary | `INTEGRATION_BINARY_UNSTABLE` | none | hook config | 要求 global install 或 stable binary | [`cli.md`](../specs/cli.md) |
| S-INT-006 | apply 失敗 | Codex config backup 成功但 patch 寫入失敗 | `INTEGRATION_APPLY_FAILED` | backup file only | broken config | 保留 recovery instructions | [`integrations.md`](../specs/integrations.md) |

## Team / Post-MVP Boundaries

| ID | Scenario | Command / Steps | Exit Code | Files Written | Must Not Write | Assertions | Source Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-TEAM-001 | config 設為 team mode | any Phase 1 command | `FEATURE_UNSUPPORTED` | none | Team Vault | command dispatch 前拒絕 | [`team-sharing.md`](../specs/team-sharing.md) |
| S-TEAM-002 | 使用者嘗試 promote | `agent-notes promote ...` | `FEATURE_UNSUPPORTED` | none | Team Vault branch | 顯示 Phase 4 roadmap | [`cli.md`](../specs/cli.md) |
| S-TEAM-003 | 使用者要匯入舊 Obsidian vault | `agent-notes init --vault-path <old-vault>` | `VAULT_EXISTS_NON_EMPTY` | none | old vault | init 不改造舊 vault；既有 Agent Notes vault 另見 S-INIT-005 | [`init-onboarding.md`](../specs/init-onboarding.md) |

## Coverage Gaps To Watch

- Codex hook 真實 config path 仍需在實作前用 dry-run fixture 定義，不應猜所有版本路徑都相同。
- `doctor` public-safe 掃描只能做 heuristic，不應宣稱能證明完全無敏感資訊。
- raw transcript copy 移到 post-MVP；Phase 1 只保存 summary-file pointer。
- Team Vault 不應在 Phase 1 實作 partial write，以免行為與 sharing 規劃衝突。
