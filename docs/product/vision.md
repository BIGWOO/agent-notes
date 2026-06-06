# 產品願景與邊界

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔說明 Agent Notes 的產品定位、問題、目標、非目標、成功指標與主要風險。

---

## 總覽

Agent Notes 是一個 local-first 筆記管理 CLI，用於 AI-assisted work。它會擷取 agent 完成的 session，轉成結構化 Markdown，安全更新專案、客戶、活動或團隊 context，並為下一次 session 準備精簡可用的 context packet。

第一批目標使用者是所有使用 AI agent 協作的人，包括一般上班族、行銷工作者、廣告投手、PM、業務、顧問、企業主管、老闆、技術管理者與開發者。他們希望用 Obsidian-compatible notes 建立穩定、可交接、可追溯的共享記憶系統。


## 問題

AI agent 完成任務後，常產生有價值的工作資訊，但這些資訊通常分散在：

- 不同工具的 transcript
- 短期 chat context
- agent-specific memory store
- 臨時 Markdown 筆記
- 與實際進度逐漸脫節的 project docs、會議紀錄、活動筆記或客戶紀錄

結果是每次重新開工都要重讀 context，決策遺失，任務清單過期，投放調整脈絡不清，客戶或團隊交接不穩。


## 目標

- 提供可重複執行的 CLI workflow，讓 agent 穩定寫入 session note。
- 用最少人工維護成本保持專案、客戶、活動與團隊 context 更新。
- 讓未來 agent 能快速找到相關前情。
- 同時支援專案任務與一般問答、閒聊、非專案討論。
- 不要求 Obsidian app 必須開啟。
- 避免私密資訊進入公開 repo。
- 讓同事與朋友能快速建立標準 Agent Notes vault。


## 非目標

- 取代 Obsidian。
- 取代 agent 原生 memory 系統。
- 儲存 secret 或 credential。
- 第一版就做完整 hosted SaaS。
- 綁定特定 AI vendor。
- 完美解析所有 raw transcript。


## 成功指標

- 新 agent 能在 30 秒內找到相關 project context。
- Session notes 都以有效 frontmatter 穩定寫入。
- Project active tasks 與 decisions 不需人工複製也能保持更新。
- 所有 generated decisions、tasks、context updates 都能透過 `trace` 找到 sourceRefs 與 session。
- 非專案閒聊不污染 project notes。
- 私密資料不被 tracked 到公開 repo。
- 團隊成員能在 10 分鐘內安裝並跑起 MVP。
- Phase 4：Team Vault 使用者能在沒有他人本機 source index 的情況下讀取 context、trace 到 team-safe metadata。
- Phase 4：Team Vault owner 能在 Git provider 中看到同事 agent 送出的 PR/MR，並依 review checklist 決定是否合併。


## 風險

| 風險 | 緩解方式 |
| --- | --- |
| 過度擷取低價值閒聊 | classification 預設 ignore/daily |
| 私密資料外洩 | 預設 private、真實路徑只放 local config、doctor warnings、public-safe examples |
| raw transcript 外洩 | Phase 1 不支援 raw transcript copy，只保存 summary-file local pointer；raw copy 移到 post-MVP 並需另定 opt-in 規格 |
| agent 產生的 Markdown 格式漂移 | 由單一 CLI 負責格式 |
| 決策或任務失去來源 | sourceRefs、provenance log、trace command、doctor orphan checks |
| Obsidian dependency 不穩 | filesystem-first design |
| 人工筆記被覆蓋 | marker blocks 與 dry-run mode |
| 並發寫入造成筆記損壞 | single-writer lock、atomic write、content hash 檢查 |
| 自動 hook 修改造成使用者不信任 | 不在 install 或 init 預設流程自動修改 hook，採 dry-run 與最後確認 |
| Team Vault 共同編輯產生 Git conflict | 預設 `branch-pr`，衝突時停止並要求人工解決，不做語意自動合併 |
| 共享筆記外洩個人路徑或 raw transcript | Team Vault tracked content 禁止 `.agent-notes/`、`private/`、本機絕對路徑與 raw transcript，`doctor` 加入 sharing 檢查 |
| 使用者混淆 Personal Vault、Team Vault 與 published read-only | onboarding 與文件明確分層，config 使用 `sharing.mode`、`access`、`agentWritePolicy` 顯示 vault 模式，publish artifact 使用獨立 manifest |
| agent 過度 promotion 造成 Team Vault PR 噪音 | v0.1 不 promotion，Phase 4 預設 `manual-pr`，`auto-pr-candidate` 必須通過 gating 並由 owner review |
| agent 把 private session 誤送 Team Vault | `visibility` 預設 private，promotion 要求 `team-safe`、sourceRefs、privacy scan 與 team target binding |


## 初始建議

第一版先做小型 filesystem-first CLI，包含標準 vault 初始化、project map、capture、context、marker block updater 與明確授權的 agent hook integration。Optional Obsidian CLI、rollup 與 Import Assistant 放到後續階段。公開 repo 保持不含私密 mapping 與內部策略；真正內部 PRD 或公司特定設定應放在 private companion repo 或本機設定中。
