# 實作進度

Status: active tracking
Last Updated: 2026-06-07
Source: [`phase-1-plan.md`](phase-1-plan.md) 與 `docs/specs/`

本檔用來追蹤 Agent Notes 從規劃到實作的整體進度。狀態值固定使用 `planned`、`in-progress`、`blocked`、`done`。

## Phase 1 Progress

| ID | Workstream | Status | Source Spec | Acceptance Criteria | Notes |
| --- | --- | --- | --- | --- | --- |
| P1-001 | Scaffold | done | [`../specs/cli.md`](../specs/cli.md) | Node.js + TypeScript CLI 可顯示 help/version，build/test/lint 可執行 | 已建立 npm/TypeScript CLI scaffold、Commander command skeleton、Vitest fixture test structure；驗證：`npm test`、`npm run build`、`npm run typecheck`、`npm run lint`、`npm exec -- agent-notes --help`、`npm exec -- agent-notes --version` |
| P1-002 | Schemas and Config | done | [`../specs/schemas.md`](../specs/schemas.md) | local config、project map、session frontmatter schema 有驗證與 fixture tests | 已實作 error code enum、Zod schemas、config loader、path expansion/canonical path helper 與 fixture tests；驗證：`npm test`、`npm run build`、`npm run typecheck`、`npm run lint` |
| P1-003 | Vault Init | done | [`../specs/init-onboarding.md`](../specs/init-onboarding.md) | fresh/already/partial/unsafe/non-interactive init cases 有測試 | 已完成非互動 `init` dry-run/apply、互動確認與 user cancel、already-initialized idempotent rerun、existing valid vault rejection、existing non-agent dir、invalid config、target file、Git worktree unsafe checks、partial init detection、keyed `init-state.json`、`--resume` 與 lock-protected `--rollback`、first project `--project-repo` 與 safe git cwd onboarding、integration onboarding preview/deferred；驗證：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run pack:dry-run`。實際 Codex hook dry-run/apply 留在 P1-010 |
| P1-004 | Project Map | done | [`../specs/cli.md`](../specs/cli.md)、[`../specs/schemas.md`](../specs/schemas.md) | `project add/list/check` 可讀寫或檢查 project map，且 read-only commands 不輸出絕對 repo path | 已實作 `project add/list/check`、project map 寫入、project context templates、idempotent add、dry-run redaction 與 unknown repo 檢查；驗證：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run pack:dry-run`、CLI smoke `init -> project add/list/check` |
| P1-005 | Capture | done | [`../specs/cli.md`](../specs/cli.md)、[`../architecture/capture-pipeline.md`](../architecture/capture-pipeline.md) | 可解析 summary file、建立 session card、dry-run 不寫檔 | 已實作 `capture` summary parser、fenced code heading 忽略、project/inbox routing、session card、source index、provenance log、`--source-file` local pointer、`--include-raw` rejection、dry-run 無副作用與 public-safe gate；驗證：`npm test -- --run tests/capture-context-trace-doctor.test.ts` |
| P1-006 | Marker Updater | done | [`../specs/marker-blocks.md`](../specs/marker-blocks.md) | marker replacement idempotent，衝突時保護人工內容 | 已實作 marker parser、single-block replacement、conflict marker 防護、idempotent item fingerprint、既有 item id 保留、sourceRefs 追加、generated item provenance 同批寫入；驗證：`npm test -- --run tests/capture-context-trace-doctor.test.ts` |
| P1-007 | Context | done | [`../architecture/context-pipeline.md`](../architecture/context-pipeline.md) | `context --repo` 輸出固定 section、bounded packet、item id、session 與 sourceRefs，且不讀 private paths | 已實作 `context --repo`、固定 section、project summary / tasks / decisions / pitfalls / recent sessions / trace hints、`--max-chars` bound、marker missing degraded output；驗證：`npm test -- --run tests/capture-context-trace-doctor.test.ts` |
| P1-008 | Doctor | done | [`../specs/cli.md`](../specs/cli.md)、[`../specs/error-codes.md`](../specs/error-codes.md) | 可檢查 config、vault、project map、templates、marker、provenance、public-safe 與 integration 狀態 | 已實作 `doctor` 與 `--check` / `--json`，read-only 檢查 config、vault、project map、templates、markers、provenance、public-safe、integrations；驗證：`npm test -- --run tests/capture-context-trace-doctor.test.ts` |
| P1-009 | Trace | done | [`../specs/provenance.md`](../specs/provenance.md) | decision/task/session/sourceRef 依固定順序回溯 source index、provenance log 與 tracked fallback | 已實作 `trace <id>` 與 `--json`，支援 sourceRef、sessionId、itemId，會檢查 source chain、session chain 與 tracked marker fallback orphan；驗證：`npm test -- --run tests/capture-context-trace-doctor.test.ts` |
| P1-010 | Integrate Codex | done | [`../specs/integrations.md`](../specs/integrations.md) | `integrate --list`、Codex dry-run、backup/apply safety 可驗證 | 已實作 `integrate --list`、fixture-driven Codex JSON config adapter、dry-run、unstable binary gate、`--apply --yes`、backup、atomic write 與 backup failure 保護；Claude Code / OpenClaw 顯示 coming soon；驗證：`npm test -- --run tests/integrate.test.ts` |
| P1-011 | Validation Gate | done | [`validation.md`](validation.md) | phase 1 必要測試與 manual checklist 通過 | 已補 Phase 1 validation evidence；驗證：`npm test`、`npm run typecheck`、`npm run lint`，最終收尾需再跑 build、pack 與 CLI smoke |
| P1-012 | Scenario Coverage | done | [`scenario-matrix.md`](scenario-matrix.md) | Phase 1 情境都有 command、expected behavior 與 source spec | Scenario matrix 已覆蓋 init、project/capture/context、doctor、trace、marker/provenance、integration、write-safety 與 post-MVP boundary；已依 P1-010/P1-005~P1-009 更新 coverage notes |
| P1-013 | Write Safety | done | [`../specs/write-safety.md`](../specs/write-safety.md) | 寫檔 command 共用 write plan、lock、backup、atomic write 與 rollback fixtures | 已實作共用 write plan、public-safe gate、lock、backup、atomic write、rollback 與 dry-run 無副作用；fixture tests 覆蓋 lock conflict、hash conflict、backup collision/traversal、temp cleanup、public-safe block 與 rollback；驗證：`npm test`、`npm run build`、`npm run typecheck`、`npm run lint`、`npm run pack:dry-run` |

## Milestone Rules

- 每個 workstream 開始前，先確認對應 spec 沒有 blocker open question。
- 狀態改為 `done` 前，必須更新 acceptance evidence 或測試結果。
- 若發現規格與實作衝突，先更新 spec，再更新本檔進度。
