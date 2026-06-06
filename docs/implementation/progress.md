# 實作進度

Status: active tracking
Last Updated: 2026-06-06
Source: [`phase-1-plan.md`](phase-1-plan.md) 與 `docs/specs/`

本檔用來追蹤 Agent Notes 從規劃到實作的整體進度。狀態值固定使用 `planned`、`in-progress`、`blocked`、`done`。

## Phase 1 Progress

| ID | Workstream | Status | Source Spec | Acceptance Criteria | Notes |
| --- | --- | --- | --- | --- | --- |
| P1-001 | Scaffold | planned | [`../specs/cli.md`](../specs/cli.md) | Node.js + TypeScript CLI 可顯示 help/version，build/test/lint 可執行 | 尚未開始實作 |
| P1-002 | Schemas and Config | planned | [`../specs/schemas.md`](../specs/schemas.md) | local config、project map、session frontmatter schema 有驗證與 fixture tests | 尚未開始實作 |
| P1-003 | Vault Init | planned | [`../specs/init-onboarding.md`](../specs/init-onboarding.md) | fresh/already/partial/unsafe/non-interactive init cases 有測試 | 近期優先 |
| P1-004 | Project Map | planned | [`../specs/schemas.md`](../specs/schemas.md) | `project add/list/check` 可讀寫 project map 並避免絕對路徑外洩 | 尚未開始實作 |
| P1-005 | Capture | planned | [`../specs/cli.md`](../specs/cli.md)、[`../architecture/capture-pipeline.md`](../architecture/capture-pipeline.md) | 可解析 summary file、建立 session card、dry-run 不寫檔 | 尚未開始實作 |
| P1-006 | Marker Updater | planned | [`../specs/marker-blocks.md`](../specs/marker-blocks.md) | marker replacement idempotent，衝突時保護人工內容 | 尚未開始實作 |
| P1-007 | Context | planned | [`../architecture/context-pipeline.md`](../architecture/context-pipeline.md) | `context --repo` 可輸出精簡 context packet | 尚未開始實作 |
| P1-008 | Doctor | planned | [`../specs/error-codes.md`](../specs/error-codes.md) | 可檢查 config、vault、project map、marker、public-safe 風險 | 尚未開始實作 |
| P1-009 | Trace | planned | [`../specs/provenance.md`](../specs/provenance.md) | decision/task/sourceRef 可回溯 source index 或 fallback metadata | 尚未開始實作 |
| P1-010 | Integrate Codex | planned | [`../specs/integrations.md`](../specs/integrations.md) | `integrate --list`、Codex dry-run、backup/apply safety 可驗證 | 尚未開始實作 |
| P1-011 | Validation Gate | planned | [`validation.md`](validation.md) | phase 1 必要測試與 manual checklist 通過 | 尚未開始實作 |

## Milestone Rules

- 每個 workstream 開始前，先確認對應 spec 沒有 blocker open question。
- 狀態改為 `done` 前，必須更新 acceptance evidence 或測試結果。
- 若發現規格與實作衝突，先更新 spec，再更新本檔進度。
