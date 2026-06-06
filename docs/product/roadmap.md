# Roadmap

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔描述產品分階段方向與各階段邊界。

---

## Roadmap

### Phase 1：Local CLI

- 建立 Node.js + TypeScript CLI
- 定義 schema
- 寫入並驗證 Markdown
- 支援 project context retrieval
- 支援安裝後 onboarding、project add 與 integration dry-run/apply
- 優先完成 Codex integration；Claude Code 與 OpenClaw 可先顯示為 coming soon

### Phase 2：Agent Hooks

- OpenClaw workflow integration
- Claude Code hook integration
- dry-run safeguards
- 更完整的 agent config path 偵測與回復工具

### Phase 3：Rollups

- daily summaries
- weekly summaries
- decision extraction
- task extraction
- area knowledge promotion

### Phase 4：Sharing Kit

- installer script
- template vault files
- sample config
- `agent-notes doctor --fix`
- Team Vault setup guide
- `project attach` for Team Vault local repo binding
- read-only mode enforcement
- branch/PR write policy for shared vaults
- Team target binding
- `promote --dry-run` / `promote --apply`
- promotion privacy gating
- PR/MR handoff template 與 owner review checklist
- `publish --readonly` sanitized output
- public documentation site 或 GitHub Pages

### Phase 5：Vault Import Assistant

- 掃描既有 Obsidian vault
- 產生整理、轉換或匯入計畫
- 只複製需要匯入的內容到標準 Agent Notes vault
- 不移動、不刪除、不修改舊 vault
- 預設 dry-run，apply 前必須逐步確認
