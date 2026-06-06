# Team Sharing 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 Personal Vault、Team Vault、promotion workflow 與 read-only publishing。

---

## Team Sharing Model

Agent Notes 的共享策略應維持 local-first，但允許團隊用 Git 或唯讀匯出共享一份標準 vault。共享不應把使用者的個人 vault、公司產品 repo 與公開 Agent Notes repo 混在一起。

建議分層：

| 層級 | 用途 | 儲存位置 | 權限模型 |
| --- | --- | --- | --- |
| Personal Vault | 個人 agent 工作紀錄與私人筆記 | 每位使用者本機，例如 `~/Documents/Agent-Notes/` | 使用者與本機 agent 可讀寫 |
| Team Vault | 團隊共用的 project context、session cards、decisions、tasks、pitfalls | 獨立 private Git repo，內容本身仍是標準 Agent Notes vault | 依 repo 權限控管 read-only 或 read-write |
| Published Read-only | 給主管、老闆或跨部門檢視的摘要 | sanitized Markdown、靜態網站或文件匯出 | 唯讀，不提供 agent 寫入 |

規則：

- `init` v0.1 一律建立新的 Personal Vault，不直接初始化 Team Vault
- Team Vault 應是獨立 private Git repo，不應放在 public `agent-notes` repo，也不應直接塞進產品程式碼 repo
- Team Vault 仍必須符合標準 Agent Notes vault 結構；CLI 不應為團隊模式發明另一套筆記格式
- Obsidian 可以開啟多個 vault，因此 Personal Vault 與 Team Vault 應並存，不應強迫使用者把既有個人 vault 改造成團隊 vault
- `private/`、`.agent-notes/`、raw transcript、本機絕對路徑與個人 project map 不應進入 Team Vault 的 Git tracked content
- 若 Team Vault 需要設定 repo 對應，應使用 team-safe aliases、repo ids 或 private companion repo，不應在 shared Markdown 寫入個人本機路徑


## Team Access Modes

以下是 Phase 4 design。v0.1 若讀到 `sharing.mode=team`，必須在 command dispatch 前回傳 `FEATURE_UNSUPPORTED`，不得只實作部分 Team Vault 行為。Team sharing 至少需要支援三種 vault access 組合，並把 read-only publishing 視為 export artifact，避免「共享」同時代表共同編輯、唯讀檢視與公開發布而造成混淆：

| Effective mode | Config 組合 | 說明 | 允許命令 |
| --- | --- | --- | --- |
| Personal | `mode=personal`、`access=read-write`、`agentWritePolicy=local-only` | 個人本機 vault，v0.1 預設模式 | `init`、`project`、`capture`、`context`、`doctor`、`integrate`、`trace`，post-MVP 可支援 `promote` |
| Team read-only | `mode=team`、`access=read-only`、`agentWritePolicy=none` | 使用者或 agent 只能讀取 Team Vault context | `context`、`trace`、`doctor --check`、`project list/check/attach`、`integrate --list/--dry-run` |
| Team read-write | `mode=team`、`access=read-write`、`agentWritePolicy=branch-pr` | 團隊成員與 agent 可對 Team Vault 提交變更 | `project`、`context`、`doctor`、`trace`、`promote --apply`，但必須受 write policy 控制 |

Team Vault command gating 規則：

- Team read-only 下，`capture`、`project add`、marker block write、raw copy、`promote --apply` 與任何會修改 Team Vault tracked content 的操作都必須拒絕
- Team read-write 下，會修改 Team Vault tracked content 的操作只能透過 `branch-pr` promotion flow 或明確受 write policy 控制的 project catalog 變更；不得 direct 寫 main
- `project list` 與 `project check` 可讀取 team catalog
- `project attach` 可寫入被忽略的 `.agent-notes/repo-bindings.json` 或 local config，但不得修改 Team Vault tracked catalog
- `doctor --check` 可檢查 shared vault 是否符合結構與 public-safe 規則，但不能自動修復 tracked content
- `integrate --list` 與 `integrate --dry-run` 可讀取本機 agent 設定；`integrate --apply` 是否允許應由本機設定權限決定，但不得寫入 shared vault
- `promote --dry-run` 可輸出 candidate 預覽；`promote --apply` 對 read-only Team Vault 必須回傳 `VAULT_READ_ONLY`
- hook 預設永遠只對 Personal Vault 執行 `capture`；Team Vault 不接受 hook direct capture
- 若未來支援 Team Vault `capture`，它只能作為 `promote` pipeline 的明確 alias，必須套用同一組 `team-safe`、sourceRefs、privacy scan 與 branch/PR gating
- CLI 必須用穩定錯誤碼回報唯讀寫入，例如 `VAULT_READ_ONLY`

寫入策略：

| Policy | 說明 | 建議用途 |
| --- | --- | --- |
| `none` | 禁止 agent 寫入 | 唯讀或主管檢視 |
| `local-only` | 只寫個人 vault | v0.1 預設 |
| `branch-pr` | 對 Team Vault 建立 local branch 與可 review handoff，不直接寫 main；自動建立 GitHub PR 或 GitLab MR 是後續 provider integration | 團隊共同編輯的建議模式 |
| `direct` | 允許直接寫入目前 branch | 只適用 personal 或 single-owner vault；Team promotion 不得使用 |

Team Vault 的 reviewed truth 應是 main branch。agent 在共同編輯時應優先使用 `branch-pr`，先產生 local branch、diff 與 commit handoff，再由人類或後續 provider integration 建立 PR/MR。若 worktree dirty、沒有 remote、provider 不支援或 branch policy 尚未實作，CLI 必須停止並回報明確錯誤。v0.1 不需要實作 distributed lock；若同一份 shared note 發生 Git conflict，CLI 應停止並提示使用者解衝突，而不是嘗試自動合併語意。


## Team Promotion Workflow

Team promotion 指的是把 Personal Vault 中已整理過、可共享的 agent session 資訊，送到對應 Team Vault 的 review branch 或 PR/MR。它不是 raw transcript sync，也不是 agent 直接寫 Team Vault main。

預期流程：

1. agent 工作完成後，hook 呼叫 `agent-notes capture`，先更新 Personal Vault
2. CLI 依 deterministic classification、`visibility`、sourceRefs、team target binding 與 privacy scan 判斷是否可產生 team promotion candidate
3. 若專案沒有 team target、session 不是 `team-safe`、包含 raw transcript、doctor privacy scan 失敗或缺少 sourceRefs，promotion 必須停止
4. `manual-pr` 模式只輸出提示或 dry-run，等待使用者或 agent 明確呼叫 `agent-notes promote`
5. `auto-pr-candidate` 模式可在 hook 後自動建立 Team Vault local branch 與 diff/commit handoff，但不得直接 merge 或直寫 main
6. 有 provider integration 時，可在使用者授權後建立 GitHub PR 或 GitLab MR
7. Team Vault owner 或 maintainer 在 Git provider 中查看同事 agent 送出的 PR/MR，檢查內容是否可共享、是否有 private data、是否污染團隊 context
8. owner 合併後，Team Vault main 才成為團隊 reviewed truth

建議 command：

```bash
agent-notes promote --session SES-20260606-001 --target team-example --dry-run
agent-notes promote --session SES-20260606-001 --target team-example --apply
```

promotion candidate 必須包含：

- 來源 Personal Vault session id
- 來源 `sourceRefs`
- target `teamVaultId`
- target `teamNotePath`
- 本次會新增或更新的 session card、source manifest、decision log、active tasks 或 pitfalls
- privacy / doctor scan 結果
- 建議 PR/MR title、body、labels 與 reviewer/owner hint

PR/MR 規則：

- branch name 建議格式為 `agent-notes/<ownerAlias>/<sessionId>`
- PR/MR title 必須包含 project name、agent/tool 與 session date
- PR/MR body 必須列出 session id、sourceRefs、derived items、風險掃描結果與人工 review checklist
- PR/MR 不應包含 raw transcript、本機絕對路徑、`.agent-notes/`、`private/` 或 personal project map
- 若 provider integration 尚未支援，CLI 只產生 local branch、commit 與 handoff instructions
- Team promotion 一律不得使用 `direct` 寫入 Team Vault main；`direct` 只保留給 personal 或 single-owner vault 的非 promotion 操作


## Shared Provenance

共享筆記的來源追溯規則詳見 [`provenance.md`](provenance.md#shared-provenance)。Team sharing 不另定一套來源格式，避免 Personal Vault、Team Vault 與 published artifact 的 trace 行為分歧。

## Read-only Publishing

主管、老闆或跨部門成員不一定需要直接操作 Obsidian vault。post-MVP 可規劃 `publish --readonly --from <vault> --out <dir> --audience <team|public>`，輸出 sanitized Markdown、靜態網站或文件包。

`publish --readonly` 規則：

- 預設 audience 必須是 `public`，只輸出 `public-safe` content
- `--audience team` 可輸出 `team-safe` 與 `public-safe` content，但產物只適合 private team sharing，不可公開發布
- 排除 `private/`、`.agent-notes/`、raw transcript、本機絕對路徑與 private project map
- 保留決策、風險、待辦、session summary 與來源的 opaque ids
- 不提供 agent 寫入入口
- 產出必須包含 publish manifest，記錄來源 vault、產出時間、過濾規則與被排除的敏感資料類型
- 不取代 Team Vault，也不是 `sharing.mode`，只是 Team Vault 或 Personal Vault 的唯讀衍生物
