# Phase 1 Implementation Plan

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 MVP 範圍與第一階段實作切片。

---

## MVP 範圍

Version 0.1 應包含：

- Node.js + TypeScript CLI
- `init`
- `doctor`
- `project add --repo`
- `context --repo`
- `capture --repo --tool --scope --summary-file [--visibility]`
- `integrate --list`
- `integrate <agent> --dry-run`
- `integrate <agent> --apply`
- `trace <itemId|sessionId|sourceRef>`
- source index 與 provenance log
- 至少一個 supported agent integration，優先支援 Codex
- personal/local-only direct Markdown writes
- project map support
- frontmatter schema
- marker block updater
- dry-run mode
- init state machine、non-interactive flags 與安全檢查
- 安裝後下一步提示
- routing 與 marker replacement 的基礎測試

## Phase 1 Implementation Plan

第一階段開發應採可驗證的小切片，不一次實作所有 agent integration。

## Scaffold

- 建立 Node.js + TypeScript 專案
- 設定 CLI entry、build、test、lint
- 建立 `src/commands/`、`src/core/`、`src/schemas/`、`src/templates/`
- 建立 fixture-based tests

## Schemas and Config

- 定義 local config schema
- 定義 project map schema
- 定義 session frontmatter schema
- 定義 source index 與 provenance log schema
- 定義 error code enum
- 實作 config loader 與 path expansion

## Vault Init

- 實作 `agent-notes init`
- 建立 `~/Documents/Agent-Notes/` 或使用者指定的新 path
- 建立 vault `.gitignore`
- 建立標準目錄與 templates
- 建立 local config 與 empty project map
- 實作 locale prompt 與 `--lang`
- 實作 locale normalization：`zh_TW`、`zh_TW.UTF-8`、`zh-Hant-TW` 等對應 `zh-TW`
- 實作 platform default paths：macOS、Linux、Windows、server/headless fallback
- 實作 init state machine：fresh、already-initialized、partial-init、invalid-config、existing-valid-vault、existing-non-agent-dir、unsafe-target；`existing-valid-vault` 在 MVP 只拒絕並建議新路徑
- 實作 local config dir `init-state.json`，以 canonical target vault path 作 key，支援 resume / rollback / complete
- 實作 idempotent init，重跑不得覆蓋 existing notes、config、project map 或 hook
- 實作 non-interactive flags：`--yes`、`--vault-path`、`--no-integrations`、`--no-project`、`--project-repo`、`--allow-git-worktree-vault`、`--resume`、`--rollback`、`--dry-run`
- 實作 path validation、canonical path、symlink handling、Git worktree detection 與 unsafe path warning
- 實作 runtime check，Node.js 不符合支援版本時回傳 `RUNTIME_UNSUPPORTED`
- 實作 first project safe cwd gating，只在明確安全 repo 詢問加入 project
- 確認所有 locale 的 templates 保留英文 machine headings

## Project Map

- 實作 `agent-notes project add --repo`
- 產生 `projectId`、`repoId`、`notePath`
- 建立 project context templates
- 實作 `project list` 與 `project check`

## Capture

- 實作 summary-file parser
- 實作 deterministic routing
- 實作 session card writer
- 實作 source index
- 實作 provenance log append
- raw transcript copy 不屬於 Phase 1；`--source-file` 只建立 local pointer
- 實作 inbox / daily / area / personal / project destinations

## Marker Updater

- 實作 marker parser
- 實作 dry-run unified diff
- 實作 backup、single-writer lock、atomic write
- 保留既有 item id 並驗證 generated item 都有 `sourceRefs`
- 實作 marker error codes
- 加入 marker replacement tests

## Context

- 實作 `agent-notes context --repo`
- 讀取 project README、active tasks、decision log、pitfalls、recent sessions
- context packet 保留 item id 與 sourceRefs
- 實作固定 section 順序與 size bound；預設 12000 chars
- 超過 `--max-chars` 時以 deterministic 順序截短並標示 omitted count
- 確認不讀 `private/`、`.agent-notes/` 或 raw transcript

## Doctor

- 實作 `--check <name>` 與 `--json`
- 驗證 config、vault、project map、templates、marker、provenance、public-safe、integrations
- 檢查 private paths 是否被 ignore，tracked Markdown 是否含 private pattern
- 檢查 orphan sourceRefs、missing provenance records 與無來源 generated items
- Phase 1 不自動修復，只輸出 blocking code、affected paths 與建議

## Trace

- 實作 `agent-notes trace <itemId|sessionId|sourceRef>`
- 讀取 source index、provenance log 與 session cards
- 依 sourceRef、sessionId、itemId 三種目標使用固定查找順序
- 輸出來源摘要、session id、note path、derivedFrom、content hash 與 warning
- 找不到 source、target 或 provenance chain 時回對應穩定錯誤碼
- 不把本機絕對路徑寫入 tracked Markdown

## Integrate Codex

- 實作 `integrate --list`
- 優先支援 Codex dry-run
- 實作 Codex apply 前 backup 與最後確認
- 偵測 CLI binary path 是否穩定；ephemeral `npx` path 不允許直接 apply hook
- 實作 init wizard 多選 integration 的 per-agent transaction 與 partial failure summary
- Claude Code 與 OpenClaw 先顯示 coming soon

## Validation Gate

- 單元測試：schema、summary parser、routing、marker updater
- 整合測試：init -> project add -> capture -> context -> doctor
- trace 測試：decision/task/sourceRef 可回溯到 source index 與 session card
- dry-run 測試：capture 與 integrate 不寫檔
- public-safe 測試：`team-safe/public-safe` 的 frontmatter、body、marker diff 命中 blocking pattern 時回 `PRIVATE_DATA_RISK` 且不寫檔
- init 測試：fresh、already-initialized、partial-init、existing-valid-vault rejection、existing-non-agent-dir、unsafe git worktree、non-interactive missing flags
- init rollback/resume 測試：中途失敗不得留下 tracked private data
- locale/template 測試：`zh-TW` UI template 仍保留英文 machine headings
- integration 測試：ephemeral `npx` binary path 不允許 apply hook，多選 partial failure 不破壞已成功項目
