# Init 與 Onboarding 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔是 `agent-notes init` 的互動、非互動、安全檢查與新手流程契約。

---

## 新使用者安裝後 onboarding

首次使用者透過 `npx` 或 `npm install -g` 安裝後，Agent Notes 不應自動修改 Codex、Claude Code、OpenClaw 或其他 agent 的 hook 設定。安裝後的預設體驗應是引導式設定。

不安裝全域 binary 時：

```bash
npx agent-notes@latest init
npx agent-notes@latest doctor
```

全域安裝時：

```bash
npm install -g agent-notes
agent-notes init
agent-notes doctor
```

預期結果：

- `init` 第一題先選擇介面語言
- `init` 建立 local config 與 vault 目錄結構
- `init` 可詢問是否將目前資料夾加入第一個 project
- `doctor` 檢查本機設定、vault、project map 與可選整合
- `init` 可在 onboarding 末段讓使用者多選要設定的 agent integrations
- `integrate --list` 顯示目前支援的 agent integration
- `integrate <agent> --dry-run` 顯示會修改哪些本機設定與呼叫哪些 command
- 只有使用者在 `init` wizard 或 `integrate <agent> --apply` 中明確確認時，才允許寫入 hook 設定
- 未全域安裝時，後續 command 都應使用 `npx agent-notes@latest ...`
- hook integration 建議使用全域安裝或固定 binary path，避免 hook 執行時找不到 CLI

`init` 的語言選擇規則：

- 產品預設語言為英文
- 第一題提供 `English` 與 `繁體中文`
- 使用者可用 `agent-notes init --lang en` 或 `agent-notes init --lang zh-TW` 跳過互動
- 偵測到系統 locale 為 `zh_TW`、`zh-TW`、`zh_TW.UTF-8`、`zh-Hant-TW` 或等價 locale 時，將 `繁體中文` 排在第一個選項或設為預選
- locale 偵測順序建議為 `LC_ALL`、`LC_MESSAGES`、`LANG`、作業系統 API fallback
- 選定語言後，後續提示、錯誤訊息與模板說明文字跟著該語言產生
- machine-readable template headings 永遠維持英文，例如 `## Summary`，避免不同語言 template 破壞 capture parser
- 語言設定寫入 local config，例如 `locale: "zh-TW"`

`init` 的 vault 建立規則：

- `init` 一律建立新的標準 Agent Notes vault，不把既有 Obsidian vault 當作初始化目標
- macOS 預設路徑為 `~/Documents/Agent-Notes/`
- Linux desktop 預設路徑為 `$XDG_DOCUMENTS_DIR/Agent-Notes/`，找不到時使用 `~/Documents/Agent-Notes/`
- Windows 預設路徑為 `%USERPROFILE%\\Documents\\Agent-Notes\\`
- server/headless 環境若找不到 Documents 目錄，應要求使用者提供 `--vault-path`，不得猜測寫入目前工作目錄
- 使用者可輸入自訂路徑，但該路徑仍代表新的標準 Agent Notes vault
- 建立前必須顯示完整路徑與將建立的標準目錄，並取得確認
- 若目標目錄已存在且是 valid Agent Notes vault，但 local config 尚未指向它，`init` v0.1 不得直接採用或綁定；必須請使用者選擇新的路徑，並提示未來可用 Import Assistant 或 reconfigure workflow 處理
- 若目標目錄已存在且非空但不是 valid Agent Notes vault，不能覆蓋、清空或在其中補結構；必須請使用者選擇新的路徑，或建議遞增路徑如 `~/Documents/Agent-Notes-2/`
- 標準 vault 建立後，使用者可用 Obsidian 開啟該 vault，並在 Obsidian 內與其他 vault 切換
- 既有 Obsidian vault 的整理、轉換或匯入不屬於 `init` 職責，應做成後續獨立 Import Assistant workflow

`init` state machine：

| State | 偵測條件 | 行為 |
| --- | --- | --- |
| `fresh` | 找不到 config，目標 vault path 不存在或為空目錄 | 進入完整 onboarding |
| `already-initialized` | config 有效，vault path 是 valid Agent Notes vault | 不重建；顯示狀態，建議 `doctor` |
| `partial-init` | config 或 vault 只建立一部分，且 local config dir 有對應的 `init-state.json` | 提供 resume / rollback / choose new path |
| `invalid-config` | config 存在但 schema 無效 | 回傳 `CONFIG_INVALID`，不得覆蓋；提示備份後修復或重新 init |
| `existing-valid-vault` | 目標 path 是 valid Agent Notes vault，但 config 尚未指向它 | 回傳 `VAULT_ALREADY_INITIALIZED`；MVP 不採用、不綁定，建議選擇新路徑 |
| `existing-non-agent-dir` | 目標 path 非空且不是 Agent Notes vault | 回傳 `VAULT_EXISTS_NON_EMPTY`，建議新路徑 |
| `unsafe-target` | 目標 path 在一般 Git worktree、repo root、系統目錄或不可寫位置 | 強警告；非互動模式回傳 `PATH_UNSAFE` 或 `PATH_INVALID` |

規則：

- valid Agent Notes vault 至少需要 vault `.gitignore`、`00-Meta/Systems/agent-note-protocol.md`、`06-Templates/` 與必要 context template
- `init` 必須可重跑且 idempotent；不得因重跑而覆蓋現有筆記、config、project map 或 hook 設定
- 初始化期間應把 `init-state.json` 寫在 local config dir，例如 `~/.config/agent-notes/init-state.json`，並以 canonical target vault path 作 key；完成後移除或標記 `complete`
- vault 內 `.agent-notes/` 只可在 vault `.gitignore` 已建立且驗證會忽略 `.agent-notes/` 後寫入
- 任一步驟失敗時不得留下已 tracked 的 partial private data
- rollback 只能移除本次 init 建立且尚未被使用者修改的檔案；無法安全 rollback 時必須提示人工處理

`init` non-interactive contract：

```bash
agent-notes init --yes --lang zh-TW --vault-path "$HOME/Documents/Agent-Notes" --no-integrations --no-project
```

規則：

- 非 TTY 環境不得顯示互動 prompt；缺少必要參數時回傳 `NON_INTERACTIVE_REQUIRED`
- `--yes` 只代表接受本次 command 顯示的 safe defaults，不得略過 destructive 或 high-trust 操作
- `--lang` 與 `--vault-path` 可跳過語言與路徑 prompt
- `--no-integrations` 跳過 integration wizard
- `--no-project` 跳過「是否加入目前資料夾為第一個 project」
- `--project-repo <path>` 可明確指定要加入的第一個 project；不得在非 git / unsafe cwd 自動推測
- `--allow-git-worktree-vault` 明確允許把 vault 建在一般 Git worktree 內；此 flag 只解除 `PATH_UNSAFE`，不解除 private data 掃描
- `--resume` 明確要求從 local config dir 的 `init-state.json` 恢復未完成的初始化
- `--rollback` 明確要求回復本次未完成初始化能安全移除的檔案
- `--dry-run` 只顯示將建立的目錄、config、project map 與 integration plan，不寫檔
- `--force` 不屬於 MVP；MVP 不提供覆蓋既有目錄的強制模式

`init` safety checks：

- Node.js runtime 版本不符合 package `engines` 時回傳 `RUNTIME_UNSUPPORTED`
- config 目錄需依平台解析：macOS/Linux 使用 XDG 或 `~/.config/agent-notes/`，Windows 使用 `%APPDATA%\\agent-notes\\`
- vault path 必須 canonicalize，並處理 `~`、環境變數、symlink 與相對路徑
- 目標 path 是檔案、parent 不存在且無法建立、parent 不可寫、或 path 含非法字元時回傳 `PATH_INVALID`
- 目標 path 位於一般 Git worktree 內時，必須警告 private vault 可能被 track；非互動模式預設拒絕，除非提供 `--allow-git-worktree-vault`
- 目標 path 位於 iCloud Drive、OneDrive、Dropbox 等同步資料夾時，應提示可能出現同步衝突，但可由使用者確認後繼續
- 第一個 project onboarding 只在 cwd 是可讀 git repo 或使用者明確提供 `--project-repo` 時詢問
- cwd 是 home、Documents、vault path、系統目錄、非 git 目錄或不可讀目錄時，不詢問加入 project
- integration wizard 若偵測到 CLI 是 `npx` ephemeral path，不應直接 apply hook；應要求 global install、固定 binary path 或顯示 manual patch
- integration 多選 apply 採 per-agent transaction：單一 agent 失敗不得影響其他 agent，最後輸出 success / skipped / failed 摘要
- integration apply 前必須 backup；partial failure 時保留 backup path 與 manual recovery instructions
- 使用者取消任何 prompt 時回傳 `INIT_CANCELLED`，不得視為成功

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
