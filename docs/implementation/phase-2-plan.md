# Phase 2 Agent Hooks Plan

Status: active planning
Last Updated: 2026-06-07
Source: [`../product/roadmap.md`](../product/roadmap.md)、[`../specs/integrations.md`](../specs/integrations.md)、[`../specs/write-safety.md`](../specs/write-safety.md)

Phase 2 聚焦 Agent Hooks。此階段先建立可驗證、可回復、可漸進擴充的 integration adapter 基礎，不重寫 Phase 1 的 Codex integration。

## 邊界

- Phase 2 預設先做 dry-run，不預設寫入任何 agent 設定。
- `apply` 只允許在 adapter 已有 fixture-driven config shape、backup、atomic write、rollback tests 與 code review 後開放。
- Claude Code 與 OpenClaw 的真實 config shape 未確認前，不猜測使用者環境；偵測不到或 shape 不明時回 `INTEGRATION_UNSUPPORTED`，並輸出 recovery hints。
- 文件、fixture 與測試不得包含公司內部 mapping、channel id、secret、客戶敏感資訊或私有 repo 細節。
- Hook command 一律委派 `agent-notes capture ...`，不得讓各 agent 自行產生 Markdown。

## Workstreams

| ID | Workstream | Status | Scope | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| P2-001 | Phase 2 planning / boundaries | done | 補 Phase 2 plan、progress、dry-run-first 與 apply gate | 文件明確列出 workstreams、風險邊界與驗證策略 |
| P2-002 | Shared integration adapter abstractions | done | 抽出共用 adapter 型別、status、dry-run hint 與 stable binary helper | Codex 既有行為不回歸；Claude/OpenClaw 可共用 status/dry-run format |
| P2-003 | Claude Code hook dry-run | done | 建立 Claude Code dry-run skeleton，不做 apply | `integrate claude-code --dry-run` 不寫檔；apply 回 `INTEGRATION_UNSUPPORTED` |
| P2-004 | OpenClaw workflow dry-run | done | 建立 OpenClaw workflow dry-run skeleton，不做 apply | `integrate openclaw --dry-run` 不寫檔；未知 workflow shape 有 hints |
| P2-005 | Apply safety / backup / rollback tests | done | 擴充 integration apply safety 測試矩陣 | apply 前 backup failure、hash conflict、rollback 與 symlink 防護都有 fixture tests |
| P2-006 | Agent config path detection and recovery hints | done | 保守偵測候選 config path，輸出不含本機絕對路徑的 recovery hints | dry-run 輸出只顯示 basename、用途、短 hash 或 redacted summary |
| P2-007 | Validation / scenario matrix update | done | 更新 scenario matrix 與 validation checklist | Phase 2 dry-run、unsupported apply、path detection 與 no-write cases 有情境覆蓋 |

## Adapter Shape 初稿

每個 adapter 先提供相同的最小契約：

- `agent`: 穩定 agent id，例如 `codex`、`claude-code`、`openclaw`
- `status(context)`: read-only 偵測支援狀態
- `dryRun(options, context)`: 回傳 planned command、偵測摘要、hints 與 no-write result
- `apply(options, context)`: 僅在已支援安全寫入後實作；未支援時回 `INTEGRATION_UNSUPPORTED`
- `format(result)`: 以人類可讀文字輸出，不洩漏本機絕對路徑

Codex adapter 是目前唯一可 apply 的 adapter。Claude Code 與 OpenClaw 在 Phase 2 前段只做 dry-run skeleton。

## 差異評估

| Agent | 目前假設 | Phase 2 前段策略 |
| --- | --- | --- |
| Codex | 已有 fixture-driven JSON config 與 stop hook patch | 保持既有 behavior，抽共用 helper 時用 tests 防回歸 |
| Claude Code | hook/config path 與 schema 可能因版本不同 | 只提供 dry-run hints；不寫入；未知 shape 回 unsupported |
| OpenClaw | workflow 可能是 local workflow、cron 或 plugin 管理 config | 只提供 workflow dry-run hints；不寫入；不假設私有 plugin path |

## 驗證策略

- 每次抽 adapter 後先跑 `npm test -- --run tests/integrate.test.ts`。
- Phase 2 scaffold 完成後跑 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`。
- 完成階段後跑 codex review；若有 high/medium 問題，先修正並重跑必要驗證。
- code review 修正不 commit，等明確要求再分批 commit。
