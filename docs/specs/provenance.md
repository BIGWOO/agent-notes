# 來源追溯規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 sourceRef、provenance log、trace 與 shared provenance 的可追溯設計。

---

## Provenance Model

所有由 Agent Notes 產生或更新的決策、任務、context 摘要與 pitfalls，都必須能回溯來源。公開可讀 Markdown 只放 opaque ids；真實 source path、raw source hash 與 local metadata 只放在被 vault `.gitignore` 排除的 `.agent-notes/`。Team Vault 若需要共享來源資訊，必須使用 tracked team-safe source manifest，不得把本機 source index 變成共享資料。

#### Source Index

`.agent-notes/source-index.json` 儲存 source ref 與本機來源的對應：

```json
{
  "version": 1,
  "sources": {
    "src_20260606_codex_001": {
      "kind": "summary-file",
      "tool": "codex",
      "capturedAt": "2026-06-06T12:00:00+08:00",
      "localPath": "$HOME/tmp/agent-summary.md",
      "contentHash": "sha256:...",
      "privacy": "private",
      "rawIncluded": false,
      "redacted": false
    }
  }
}
```

規則：

- `sourceRef` 格式建議為 `src_<YYYYMMDD>_<tool>_<sequence>`
- `localPath` 只能存在 `.agent-notes/source-index.json`
- session card、decision log、active tasks、context files 只能引用 opaque `sourceRef`
- `contentHash` 用於驗證本機 source 是否被修改；若 hash 對象是 raw transcript 或本機檔案，hash 只能存在 `.agent-notes/source-index.json`
- personal mode 找不到 source ref 時，`trace` 回傳 `SOURCE_NOT_FOUND`
- 若團隊需要共同追溯同一個來源，應使用可共享的 `sourceKind`、`tool`、`capturedAt`、`ownerAlias`、PR/MR URL 或文件 URL 等 metadata，不得要求他人讀取另一位使用者的本機路徑

#### Team-safe Source Manifest

Team Vault 可 tracked 一份 team-safe source manifest，例如 `00-Meta/Systems/source-manifest.md`，用來保存能被團隊共享的來源摘要。這份 manifest 不是 local source index，不能存本機絕對路徑、raw transcript hash 或私人檔案路徑。

範例：

```markdown
<!-- agent-notes:start source-manifest -->
- sourceRef: src_20260606_codex_001
  sourceKind: pull-request
  tool: codex
  capturedAt: 2026-06-06T12:00:00+08:00
  ownerAlias: bw
  safeSourceUrl: https://example.com/org/repo/pull/123
  safeContentHash: sha256:...
<!-- agent-notes:end source-manifest -->
```

規則：

- `safeSourceUrl` 只能指向團隊有權讀取的 PR/MR、issue、文件或其他 approved source
- `safeContentHash` 只能針對 public-safe 或 team-safe artifact 計算，不得代表 raw transcript 或本機私人檔案
- Team Vault 的 `trace` 找不到本機 source index 但找到 source manifest 時，應顯示 degraded trace 與 team-safe metadata，exit code 仍為 `OK`
- 只有 source index 與 source manifest 都找不到目標 source ref 時，才回傳 `SOURCE_NOT_FOUND`

#### Team-safe Provenance Manifest

Team Vault 不能依賴 ignored `.agent-notes/provenance.jsonl` 作為唯一 trace 來源。Phase 4 可 tracked 一份 team-safe provenance manifest，例如 `00-Meta/Systems/provenance-manifest.md`，用來保存 item-level provenance 的公開給團隊版本。

範例：

```markdown
<!-- agent-notes:start provenance-manifest -->
- itemId: DEC-0001
  itemType: decision
  sessionId: SES-20260606-001
  sourceRefs:
    - src_20260606_codex_001
  derivedFrom: summary-file:Decisions
  notePath: 03-Projects/Example/03-context/decision-log.md
<!-- agent-notes:end provenance-manifest -->
```

規則：

- Team provenance manifest 不得保存本機絕對路徑、raw transcript path 或私人檔案 hash
- Team Vault generated blocks 與 session cards 必須保留 `session`、`sourceRefs` 與 `derivedFrom`，讓 `trace` 可從 tracked Markdown fallback
- Team Vault `trace` 查找順序應為 local `.agent-notes/provenance.jsonl`、tracked team provenance manifest、tracked session cards / marker blocks、team source manifest
- 若 item 有 `sourceRefs` 但找不到 session、derivedFrom 或 tracked provenance，`trace` / `doctor` 應回傳 `PROVENANCE_ORPHAN`，不得只因找到 source manifest 就回 `OK`

#### Provenance Log

`.agent-notes/provenance.jsonl` 記錄 item 產生、更新與來源關係：

```json
{"event":"derived","itemId":"DEC-0001","itemType":"decision","sessionId":"SES-20260606-001","sourceRefs":["src_20260606_codex_001"],"derivedFrom":"summary-file:Decisions","createdAt":"2026-06-06T12:05:00+08:00"}
```

規則：

- 每個 generated item 必須有 `itemId`
- decision id 使用 `DEC-0001`
- task id 使用 `TASK-0001`
- context update id 使用 `CTX-0001`
- pitfall id 使用 `PIT-0001`
- marker updater 更新既有 item 時必須保留 item id
- 無法確認來源的 generated item 不得寫入 project context，只能留在 inbox 或 dry-run output

#### Generated Item Format

Decision log generated block：

```markdown
<!-- agent-notes:start decision-log -->
- DEC-0001 | 採用 Node.js + TypeScript 作為 MVP CLI runtime
  - status: accepted
  - sourceRefs: src_20260606_codex_001
  - session: SES-20260606-001
<!-- agent-notes:end decision-log -->
```

Active tasks generated block：

```markdown
<!-- agent-notes:start active-tasks -->
- TASK-0001 | 實作 marker block updater
  - status: planned
  - sourceRefs: src_20260606_codex_001
  - relatedDecisions: DEC-0001
<!-- agent-notes:end active-tasks -->
```

#### Trace Command

```bash
agent-notes trace DEC-0001
agent-notes trace TASK-0001
agent-notes trace src_20260606_codex_001
```

預期輸出：

- item id 與 type
- item 所在 note path
- sourceRefs
- session id
- derivedFrom section
- content hash
- 若 source 位於本機 private index，顯示 safe local summary，不直接把絕對路徑寫入 Markdown

## Shared Provenance

共享筆記仍必須可追溯，但不能把個人機器上的私密 mapping 分享出去。

規則：

- Team Vault tracked Markdown 可以保存 `sessionId`、`itemId`、opaque `sourceRefs`、team-safe metadata 與 optional `safeContentHash`
- 每位使用者的 `.agent-notes/source-index.json` 只負責本機 trace，不應 commit
- Team Vault 若需要跨人追溯，應保存可共享來源，例如 PR/MR URL、issue URL、文件 URL、commit hash、agent tool 名稱、capture time 與 `ownerAlias`
- promotion 產生的 Team Vault changes 必須保留來源 Personal Vault session id 與 sourceRefs，但不得要求 reviewer 讀取發起者本機 source index
- `trace` 在 Team Vault 找不到本機 source index 時，應退回顯示 tracked Markdown 與 team-safe metadata，不應報成資料損壞
- raw transcript 在 team sharing 中必須維持 opt-in，且預設不進入 Team Vault tracked content
