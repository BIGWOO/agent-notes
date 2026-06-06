# CLI Command 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 CLI command plan 與各 command 的階段、用途與基本契約。

---

## CLI Command Plan

| Command | 階段 | 用途 |
| --- | --- | --- |
| `init` | v0.1 | 建立標準 Agent Notes vault、初始化 config，並可選擇啟動 integration wizard |
| `project` | v0.1 | 新增、列出與檢查 project map entries；Phase 4 支援 Team Vault `attach` |
| `capture` | v0.1 | 從目前 context 或指定檔案建立 session card，並可用 `--visibility` 明確設定 sharing visibility |
| `context` | v0.1 | 為 repo 輸出 context packet |
| `doctor` | v0.1 | 驗證設定 |
| `integrate` | v0.1 | 偵測、預覽與明確套用 agent hook integration |
| `trace` | v0.1 | 追溯 item id、session id 或 source ref 的來源 |
| `rollup` | Phase 3 | 產生每日或每週摘要 |
| `classify` | post-MVP | 預覽 routing decision |
| `sync` | post-MVP | 可選 Git-aware note sync helper |
| `promote` | Phase 4 | 將 `team-safe` personal session 產生 Team Vault branch/PR handoff |
| `publish` | Phase 4 | 產生 sanitized read-only sharing output |

## 安裝後預設流程

`init` 是使用者第一次執行時的主要入口。MVP 的 `init` 應聚焦在建立 local-first runtime，而不是直接接管 agent：

1. 選擇語言，並依系統 locale 調整預選順序
2. 選擇標準 Agent Notes vault 的建立路徑，預設使用 `~/Documents/Agent-Notes/`
3. 若目標路徑已存在且非空，提示改用新的路徑，不在既有 Obsidian vault 補結構
4. 顯示將建立的標準 vault 目錄與檔案
5. 使用者確認後才建立必要目錄
6. 建立新的 Obsidian-compatible Agent Notes vault
7. 建立 `~/.config/agent-notes/config.json`
8. 建立本機 project map
9. 詢問是否把目前資料夾加入第一個 project
10. 顯示 manual capture 與 context command 範例
11. 詢問是否現在連接 AI agents，並提供可多選的 agent 清單
12. 對使用者選取的每個 agent 顯示 dry-run 摘要與確認提示
13. 使用者逐一確認後，委派 `integrate` engine 套用對應設定
14. 自動執行或建議執行 `agent-notes doctor`

Hook integration engine 必須獨立於 `init`，讓使用者日後可用 `agent-notes integrate ...` 補設定；`init` 只是首次 onboarding 的互動式呼叫入口。
