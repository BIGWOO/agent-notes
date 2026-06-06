# Agent Notes

Agent Notes 是一個 local-first CLI，用來把 AI agent 完成的工作、討論、決策與行動項目整理成可長期保存、可搜尋、可交接的 Markdown 筆記。

它服務所有使用 AI agent 協作的人：一般上班族、行銷工作者、廣告投手、PM、業務、顧問、企業主管、老闆、開發者，以及使用 Codex、OpenClaw、Claude Code 等工具的技術團隊。目標是讓 agent 在完成任務後可以穩定做到：

- 將完成的工作、問答、會議討論、投放檢討寫成結構化 session note
- 更新專案、客戶、活動或團隊上下文，而且不覆蓋人工筆記
- 定期整理每日或每週進度
- 讓下一個 agent 開工前能快速取得可靠 context
- 避免把私密部署資訊、channel mapping、secret 誤放進公開 repo

主要儲存目標是 Obsidian-compatible Markdown vault。Obsidian app 本身不是 runtime 必要條件：核心流程直接讀寫檔案；Obsidian CLI 則作為搜尋、連結、backlinks、開啟筆記等輔助能力。

## 狀態

規劃階段。目前這個 repo 放的是公開安全版產品規劃與預計的 CLI 介面。

## 核心概念

多數 agent session 都會產生有價值的知識，例如工作進度、客戶溝通、廣告投放調整、會議決策、老闆交辦事項或技術實作紀錄，但這些資訊常被困在 transcript、chat log 或各工具自己的 memory 裡。Agent Notes 將資訊拆成幾個層級：

| 層級 | 用途 | 範例位置 |
| --- | --- | --- |
| Raw session | 保留追溯與稽核線索 | `01-Inbox/raw-sessions/` |
| Session card | 單次有意義工作單元的結構化摘要 | `03-Projects/<project>/04-sessions/` |
| Project rollup | 專案、客戶、活動、團隊現況與決策 | `03-Projects/<project>/03-context/` |
| Periodic review | 每日或每週跨專案摘要 | `02-Daily/` |

## 預計 CLI

```bash
agent-notes init --vault ~/notes
agent-notes capture --repo "$PWD" --tool codex
agent-notes context --repo "$PWD"
agent-notes rollup --daily
agent-notes rollup --weekly
agent-notes doctor
```

## 設計原則

- Local-first：檔案系統是主要真相來源。
- Obsidian-compatible：產生的 Markdown 要能在 Obsidian、GitHub、一般編輯器中良好閱讀。
- Headless-safe：cron 與 agent hook 必須能在 Obsidian 未開啟時運作。
- Public-safe by default：私密 mapping、secret、內部部署資訊預設排除在公開 repo 外。
- Agent-neutral：Codex、OpenClaw、Claude Code 與未來 agent 都使用同一套 capture protocol。
- Human-owned：自動化只更新 marker block，保留人工撰寫區塊。

## 公開與私有文件策略

如果這個 repo 是公開的，任何 commit 並 push 到公開 branch 的內容都視為公開。

這個公開 repo 適合放：

- 產品願景
- 公開安全版 PRD
- CLI command design
- templates
- 通用安裝說明
- 不含敏感資訊的範例

以下內容應放在私有 repo、本機私有分支，或使用者自己的本機設定檔：

- 私有 project map
- Discord、Slack、Lark、GitHub 等 channel 或 user id
- 會暴露公司結構的內部 repo 路徑
- API key、token、secret、credential
- 私有 roadmap、vendor note、客戶或營運情境

本 repo 的 `.gitignore` 已排除常見私密路徑，例如 `docs/internal/`、`private/`、`.env*`、`.agent-notes.local.json`。

## Repo 結構

```text
.
├── README.md
├── docs/
│   └── PRD.md
├── .gitignore
└── LICENSE
```

## 授權

MIT
