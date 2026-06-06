# Open Questions

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔集中管理未決問題，避免散落在 PRD 各處。

---

## Open Questions

- Phase 3 rollup 要用 deterministic extraction、local LLM，還是 hosted LLM？
- 第一批正式支援的 agent hook 順序應是 Codex、Claude Code 還是 OpenClaw？
- Import Assistant 的互動 UX 要採逐檔確認、批次確認，還是只輸出可套用計畫？
- private companion repo 是否需要官方 scaffold，或只先提供文件建議？
- Team Vault 的第一版應支援 GitHub PR、GitLab MR，還是只定義 branch handoff contract？
- `auto-pr-candidate` 是否應預設關閉，並只允許 project owner 逐專案開啟？
- Team Vault owner review queue 是否只依 Git provider UI，或需要 `agent-notes promote list` 類 CLI 輔助？
- `publish --readonly` 第一版應輸出純 Markdown、靜態網站，還是可匯入 Google Docs/Notion 的文件包？
