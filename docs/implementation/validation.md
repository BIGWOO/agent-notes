# Validation Plan

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔追蹤測試策略、驗收條件與 manual verification checklist。

---

## Validation Strategy

第一階段驗證以 deterministic command behavior、fixture-based tests 與 public-safe 檢查為主。每個實作切片完成時，至少要能回到對應 spec 驗證 acceptance criteria。

## Validation Gate

- 單元測試：schema、summary parser、routing、marker updater
- 整合測試：init -> project add -> capture -> context -> doctor
- trace 測試：decision/task/sourceRef 可回溯到 source index 與 session card
- dry-run 測試：capture 與 integrate 不寫檔
- public-safe 測試：session card 不含絕對路徑
- init 測試：fresh、already-initialized、partial-init、existing-valid-vault rejection、existing-non-agent-dir、unsafe git worktree、non-interactive missing flags
- init rollback/resume 測試：中途失敗不得留下 tracked private data
- locale/template 測試：`zh-TW` UI template 仍保留英文 machine headings
- integration 測試：ephemeral `npx` binary path 不允許 apply hook，多選 partial failure 不破壞已成功項目


## Manual Verification Checklist

- `agent-notes --help` 與 `agent-notes --version` 可執行
- `agent-notes init --dry-run` 不寫檔
- `agent-notes init --yes --lang zh-TW --vault-path <tmp> --no-integrations --no-project` 可建立標準 vault
- `agent-notes doctor` 可檢查 local config、vault 結構與 public-safe 風險
- `agent-notes capture --dry-run` 可解析 summary file 並顯示預計寫入內容
