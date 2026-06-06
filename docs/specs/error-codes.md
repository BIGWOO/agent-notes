# Error Codes 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 CLI 穩定錯誤碼；實作與測試應以 code 為準。

---

## Error Codes

MVP command 應使用穩定、可機器判讀的錯誤碼。CLI 可同時輸出人類可讀訊息，但測試應以 code 為準。

| Code | Exit | Command | 意義 | 建議動作 |
| --- | --- | --- | --- | --- |
| `OK` | 0 | all | 成功 | 無 |
| `CONFIG_NOT_FOUND` | 10 | config-requiring commands | 找不到 local config；`init`、`integrate --list`、`--help`、`--version` 不需要 config | 執行 `agent-notes init` |
| `CONFIG_INVALID` | 11 | all | local config schema 無效 | 修正 config 或重新 init |
| `VAULT_NOT_FOUND` | 12 | all except `init` | vault path 不存在 | 檢查 config 或重新 init |
| `VAULT_NOT_WRITABLE` | 13 | init/capture/project | vault 不可寫 | 修正權限或改路徑 |
| `VAULT_READ_ONLY` | 14 | capture/project/sync/promote | 目前 vault 或 sharing mode 不允許寫入 | 改用個人 vault、切換權限或建立 PR/MR |
| `VAULT_ALREADY_INITIALIZED` | 15 | init | 目標 path 已是 valid Agent Notes vault | 若 local config 已指向此 vault，執行 `doctor`；否則選擇新路徑，MVP 不直接採用 |
| `VAULT_EXISTS_NON_EMPTY` | 16 | init | 目標 path 非空且不是 Agent Notes vault | 選擇新路徑 |
| `INIT_PARTIAL` | 17 | init/doctor | 偵測到未完成的初始化狀態 | resume、rollback 或選擇新路徑 |
| `PATH_INVALID` | 18 | init | 目標 path 是檔案、不可建立、不可寫或非法 | 修正路徑 |
| `PATH_UNSAFE` | 19 | init | 目標 path 位於一般 Git worktree、系統目錄或其他高風險位置 | 改用安全路徑或明確允許 |
| `PROJECT_NOT_FOUND` | 20 | project/context/capture | repo 無法解析到 project | v0.1 personal vault 執行 `project add --repo "$PWD"`；Phase 4 Team Vault 執行 `project attach --repo "$PWD" --project-id <id>` |
| `PROJECT_MAP_INVALID` | 21 | project/context/capture/doctor | project map schema 無效 | 修正 project map |
| `INVALID_SCOPE` | 30 | capture | `--scope` 不在允許值 | 使用合法 scope |
| `INVALID_SUMMARY_FILE` | 31 | capture | summary file 缺 heading 或 Summary 空白 | 依 template 修正 summary file |
| `SOURCE_FILE_NOT_FOUND` | 32 | capture | `--source-file` 不存在 | 修正 source path 或移除參數 |
| `RAW_REQUIRES_SOURCE_FILE` | 33 | capture | post-MVP raw copy 中，`--include-raw` 未搭配 `--source-file` | 補 `--source-file` 或移除 `--include-raw` |
| `SOURCE_NOT_FOUND` | 34 | trace/doctor | 找不到 source ref | 檢查 source index 或重新 capture |
| `TRACE_TARGET_NOT_FOUND` | 35 | trace | 找不到 item id 或 session id | 確認 id 是否正確；source ref 缺失使用 `SOURCE_NOT_FOUND` |
| `PROVENANCE_ORPHAN` | 36 | doctor/trace | item 有 sourceRefs，但找不到 local provenance、team provenance manifest、team source manifest 或可 fallback 的 tracked Markdown | 執行 doctor 並修復 index 或 manifest |
| `MARKER_MISSING` | 40 | capture | 找不到必要 marker block | 重新建立 context template 或手動補 marker |
| `MARKER_INVALID` | 41 | capture | marker block 巢狀、缺 end 或 id 不一致 | 修正 marker block |
| `WRITE_CONFLICT` | 42 | capture/project | 寫入前檔案已被其他程序改動 | 重新執行 command |
| `BACKUP_FAILED` | 43 | capture/project/integrate | backup 建立失敗 | 檢查 `.agent-notes/backups/` 權限 |
| `PRIVATE_DATA_RISK` | 50 | doctor/capture | 偵測到可能外洩的絕對路徑或敏感 pattern | 改用 private config 或重新 redact |
| `INTEGRATION_UNSUPPORTED` | 60 | integrate/init | agent 尚未支援 apply | 查看 `integrate --list` |
| `INTEGRATION_NOT_FOUND` | 61 | integrate/init | 找不到目標 agent config | 安裝 agent 或指定 config path |
| `INTEGRATION_APPLY_FAILED` | 62 | integrate/init | hook 設定寫入失敗 | 檢查 backup 與權限 |
| `INTEGRATION_BINARY_UNSTABLE` | 63 | integrate/init | hook 會引用 ephemeral `npx` 或不穩定 binary path | 改用 global install、固定 binary path 或 manual patch |
| `INTEGRATION_PARTIAL_FAILED` | 64 | integrate/init | 多選 integration 部分成功、部分失敗 | 查看 per-agent summary 與 backup |
| `FEATURE_UNSUPPORTED` | 70 | all | config 或 command 使用尚未實作的 post-MVP 功能 | 改用 v0.1 支援模式或升級版本 |
| `RUNTIME_UNSUPPORTED` | 71 | all | Node.js 或作業系統版本不符合支援範圍 | 升級 runtime |
| `NON_INTERACTIVE_REQUIRED` | 72 | init | 非 TTY 環境缺少必要 flags | 補 `--yes`、`--lang`、`--vault-path` 等 flags |
| `INIT_CANCELLED` | 73 | init | 使用者取消初始化 | 不需處理，必要時重新執行 |
| `WORKTREE_DIRTY` | 80 | sync/capture/project/promote | branch handoff 前工作區已有未處理變更 | 先 commit、stash 或切換工作區 |
| `GIT_REMOTE_UNSUPPORTED` | 81 | sync/publish/promote | remote 或 provider 不支援目前操作 | 改用 local handoff 或手動建立 PR/MR |
| `BRANCH_POLICY_UNSUPPORTED` | 82 | sync/capture/project/promote | 目前版本尚未支援指定 branch write policy | 改用 `local-only` 或手動流程 |
| `TEAM_TARGET_NOT_FOUND` | 83 | promote | personal project 沒有可用 team target binding | 設定 team target 或改用 personal-only |
| `PROMOTION_NOT_ALLOWED` | 84 | promote | session 不符合 promotion gating，例如不是 `team-safe`、缺 sourceRefs、含 raw transcript 或 privacy scan 失敗 | 修正 session visibility、來源與敏感資訊後重試 |
| `PROMOTION_PROVIDER_UNSUPPORTED` | 85 | promote | 目前 provider 無法自動建立 PR/MR | 使用 local branch handoff 或手動建立 PR/MR |
| `UNKNOWN_ERROR` | 99 | all | 未分類錯誤 | 保留 log 並回報 |
