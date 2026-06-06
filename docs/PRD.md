# Agent Notes PRD

Status: planning
Last Updated: 2026-06-06

Agent Notes 是一個 local-first CLI，用來把 AI agent 完成的工作、討論、決策與行動項目整理成可長期保存、可搜尋、可交接、可追溯的 Obsidian-compatible Markdown vault。

本 PRD 現在只作為產品入口與規格索引；詳細行為契約、架構與實作進度拆到 `docs/product/`、`docs/specs/`、`docs/architecture/` 與 `docs/implementation/`。

## 產品定位

第一批目標使用者包含一般上班族、行銷工作者、廣告投手、PM、業務、顧問、企業主管、老闆、技術主管、開發者與 AI agent。Agent Notes 的核心價值是讓 agent session 產生的知識不被困在 transcript 或工具記憶裡，而能沉澱成可由人類擁有、可由下一個 agent 讀取的 Markdown 筆記。

完整產品願景與邊界見 [`product/vision.md`](product/vision.md)。

## 核心目標

- 提供可重複執行的 CLI workflow，讓 agent 穩定寫入 session note。
- 用最少人工維護成本保持專案、客戶、活動與團隊 context 更新。
- 讓未來 agent 能快速找到相關前情。
- 同時支援專案任務與一般問答、閒聊、非專案討論。
- 不要求 Obsidian app 必須開啟。
- 避免私密資訊進入公開 repo。
- 讓同事與朋友能快速建立標準 Agent Notes vault。

## 非目標

- 不取代 Obsidian。
- 不取代 agent 原生 memory 系統。
- 不儲存 secret 或 credential。
- 第一版不做完整 hosted SaaS。
- 不綁定特定 AI vendor。
- 不追求完美解析所有 raw transcript。

## MVP 範圍

Version 0.1 聚焦 Local CLI：

- Node.js + TypeScript CLI scaffold
- `init`、`project add/list/check`、`capture`、`context`、`doctor`、`trace`
- Codex integration dry-run / apply safety
- Local config、project map、session frontmatter、source index schema
- Obsidian-compatible vault 結構與 templates
- deterministic marker block updater
- public-safe 與 provenance 檢查

完整 Phase 1 任務見 [`implementation/phase-1-plan.md`](implementation/phase-1-plan.md)，實作進度見 [`implementation/progress.md`](implementation/progress.md)。

## 文件索引

### Product

- [`product/vision.md`](product/vision.md)：產品願景、問題、目標、非目標、成功指標、風險
- [`product/users-and-use-cases.md`](product/users-and-use-cases.md)：目標使用者與核心使用情境
- [`product/roadmap.md`](product/roadmap.md)：Phase 1-5 roadmap

### Specs

- [`specs/init-onboarding.md`](specs/init-onboarding.md)：`agent-notes init`、語言選擇、vault path、安全檢查、integration wizard
- [`specs/cli.md`](specs/cli.md)：CLI command plan
- [`specs/vault-structure.md`](specs/vault-structure.md)：vault 結構、分類策略、public/private 邊界
- [`specs/schemas.md`](specs/schemas.md)：local config、session card、project map、capture contract
- [`specs/provenance.md`](specs/provenance.md)：sourceRef、trace、shared provenance
- [`specs/marker-blocks.md`](specs/marker-blocks.md)：marker block updater
- [`specs/integrations.md`](specs/integrations.md)：agent hooks 與 optional integrations
- [`specs/team-sharing.md`](specs/team-sharing.md)：Team Vault、promotion workflow、read-only publishing
- [`specs/templates.md`](specs/templates.md)：MVP templates
- [`specs/error-codes.md`](specs/error-codes.md)：CLI error codes

### Architecture

- [`architecture/runtime.md`](architecture/runtime.md)：runtime 架構與 command runtime
- [`architecture/capture-pipeline.md`](architecture/capture-pipeline.md)：capture pipeline
- [`architecture/context-pipeline.md`](architecture/context-pipeline.md)：context pipeline

### Implementation

- [`implementation/phase-1-plan.md`](implementation/phase-1-plan.md)：Phase 1 實作切片
- [`implementation/progress.md`](implementation/progress.md)：實作進度追蹤
- [`implementation/scenario-matrix.md`](implementation/scenario-matrix.md)：使用情境模擬與規格覆蓋檢查
- [`implementation/validation.md`](implementation/validation.md)：驗證策略與 manual checklist
- [`implementation/open-questions.md`](implementation/open-questions.md)：未決問題
- [`decisions/ADR-0001-runtime-node-typescript.md`](decisions/ADR-0001-runtime-node-typescript.md)：runtime 選型決策

## Public-safe 規則

這是 public repo，任何 commit 並 push 到公開 branch 的內容都視為公開。文件不得放公司內部 mapping、channel id、secret、客戶敏感資訊或私有 repo 細節。真實 project map、credential、私有 runbook 與內部商業情境應放在 local config、private companion repo 或使用者自己的私有 vault。
