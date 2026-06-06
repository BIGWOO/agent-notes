# Schema 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 local config、session card、project map 與 capture contract。來源追溯模型另見 `provenance.md`。

---

## Implementation Contract

Phase 1 schema 實作建議使用 Zod，並在 `src/schemas/` 匯出 runtime validators 與 TypeScript types。規格不要求先手寫完整 JSON Schema，但測試 fixture 必須覆蓋 valid / invalid cases。

共同規則：

- 所有 schema 都必須包含 `version` 或 `schemaVersion`。
- path input 進 schema 前先 canonicalize；tracked Markdown 只允許 vault-relative path。
- local/private schema 可以保存絕對路徑；tracked Markdown schema 不得保存絕對路徑。
- unknown keys 在 config 與 project map 中可先保留但不得依賴；session frontmatter 的 unknown top-level keys 應保留以相容人工擴充。
- enum 遇到尚未支援值時，不可靜默降級；若屬 post-MVP config，回傳 `FEATURE_UNSUPPORTED`。
- schema migration 不屬於 Phase 1；讀到不支援版本回傳 `CONFIG_INVALID` 或對應 schema error。

## 資料模型

## Local Config

Local config 放在使用者本機，不應 commit 到 public repo：

```json
{
  "version": 1,
  "locale": "zh-TW",
  "vaultPath": "$HOME/Documents/Agent-Notes",
  "projectMapPath": "$HOME/.config/agent-notes/project-map.json",
  "privacy": {
    "defaultVisibility": "private",
    "recordAbsolutePathsInNotes": false,
    "copyRawTranscripts": false
  },
  "sharing": {
    "mode": "personal",
    "access": "read-write",
    "agentWritePolicy": "local-only"
  },
  "integrations": {
    "codex": {
      "enabled": false
    }
  }
}
```

規則：

- `locale` 預設 `en`，但系統 locale 為 `zh_TW` 或 `zh-TW` 時可預選 `zh-TW`
- `vaultPath` 指向標準 Agent Notes vault
- `projectMapPath` 指向本機或 private project map
- `recordAbsolutePathsInNotes` 預設 `false`
- `copyRawTranscripts` 預設 `false`
- `sharing.mode` v0.1 預設 `personal`，post-MVP 可選值規劃為 `personal | team`
- `sharing.access` 可選值規劃為 `read-write | read-only`
- `sharing.agentWritePolicy` 可選值規劃為 `none | local-only | branch-pr | direct`
- v0.1 schema 只接受 `personal` + `read-write` + `local-only`；若 config 出現尚未實作的 team sharing 值，CLI 必須回傳 `FEATURE_UNSUPPORTED`，不得靜默接受
- `published-read-only` 不是 vault config mode，而是 `publish --readonly` 產生的衍生 artifact
- integration 狀態只記錄本機設定，不寫入 secret

Phase 1 欄位契約：

| Field | Required | Type | Phase 1 Allowed | Notes |
| --- | --- | --- | --- | --- |
| `version` | yes | integer | `1` | 不支援其他版本 |
| `locale` | yes | string | `en`、`zh-TW` | init 需 normalize locale alias |
| `vaultPath` | yes | string | absolute path | local-only，可含 `$HOME` input，但儲存前建議展開 |
| `projectMapPath` | yes | string | absolute path | local-only |
| `privacy.defaultVisibility` | yes | enum | `private` | `team-safe`、`public-safe` 需由 command 明確指定 |
| `privacy.recordAbsolutePathsInNotes` | yes | boolean | `false` | Phase 1 不允許 true 寫入 tracked Markdown |
| `privacy.copyRawTranscripts` | yes | boolean | `false` | Phase 1 固定 false；raw copy 屬 post-MVP |
| `sharing.mode` | yes | enum | `personal` | `team` 回傳 `FEATURE_UNSUPPORTED` |
| `sharing.access` | yes | enum | `read-write` | `read-only` 屬 Team Vault 規劃 |
| `sharing.agentWritePolicy` | yes | enum | `local-only` | 其他值屬 post-MVP |
| `integrations.codex.enabled` | no | boolean | `true | false` | 不保存 secret |

## Session Card Frontmatter

```yaml
---
type: agent-session
schemaVersion: 1
title: "Short session title"
date: "2026-06-06"
capturedAt: "2026-06-06T12:00:00+08:00"
agent: codex
tool: Codex
projectId: example
project: Example
repoId: example
scope: project
status: done
visibility: private
source:
  kind: summary-file
  ref: local-summary-2026-06-06
  rawIncluded: false
sourceRefs:
  - src_20260606_codex_001
derivedItems:
  decisions:
    - DEC-0001
  tasks:
    - TASK-0001
tags:
  - session
  - codex
---
```

規則：

- `visibility` 可選值為 `private | team-safe | public-safe`
- `visibility` 預設為 `private`
- `team-safe` 表示可放入 private Team Vault，但不可公開發布
- `public-safe` 表示可公開發布
- `team-safe` 與 `public-safe` 必須由使用者明確指定，並通過 `doctor` 的敏感資訊掃描；agent 不得自動把 `private` note 升級為可共享狀態
- session card frontmatter 預設不寫入絕對 repo path、vault path、user home path 或 private project map path
- 真實 repo path 只放在 local config 或 private project map
- `scope: project` 時，`projectId` 與 `repoId` 必填，且必須可回查到 local project map
- `scope: inbox | daily | area | personal` 時，`projectId`、`repoId` 與 `project` display field 可省略
- 非 project scope 的目的地由 `scope` 決定，例如 `inbox` 寫入 `01-Inbox/`，`daily` 寫入 `02-Daily/`
- `sourceRefs` 必須使用 opaque source id，不得使用本機絕對路徑
- `derivedItems` 記錄本 session 產出的 decision、task、context update 等 item id

Phase 1 欄位契約：

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `type` | yes | literal | `agent-session` |
| `schemaVersion` | yes | integer | `1` |
| `title` | yes | string | 不得空白 |
| `date` | yes | date string | `YYYY-MM-DD` |
| `capturedAt` | yes | ISO datetime string | 用於 recent sessions 排序 |
| `agent` | yes | string | CLI value，例如 `codex` |
| `tool` | yes | string | 人類可讀 tool name |
| `scope` | yes | enum | `ignore` 不會產生 session card |
| `status` | yes | enum | Phase 1 使用 `done` 或 `handoff` |
| `visibility` | yes | enum | `private | team-safe | public-safe` |
| `source.kind` | yes | enum | Phase 1 使用 `summary-file` |
| `source.ref` | yes | string | opaque source ref |
| `source.rawIncluded` | yes | boolean | true 時 visibility 必須是 `private` |
| `sourceRefs` | yes | string[] | 至少一筆 |
| `derivedItems` | yes | object | arrays 可空 |
| `projectId` | scope project only | string | 必須存在於 project map |
| `repoId` | scope project only | string | 必須存在於 project map |

Tracked session card frontmatter 不允許以下欄位：`repoPath`、`vaultPath`、`projectMapPath`、`sourceFilePath`、`homePath`。

## Session Card Body

```markdown
# Short session title

## Summary

## Changes

## Decisions

## Validation

## Next Steps

## Handoff

## Source
```

## Project Map

Project map 預設應放本機或私有位置。

```json
{
  "version": 1,
  "vaultPath": "$HOME/Documents/Agent-Notes",
  "projects": [
    {
      "id": "example",
      "name": "Example",
      "repoId": "example",
      "repoPaths": ["$HOME/repos/example"],
      "notePath": "03-Projects/Example",
      "tags": ["example"],
      "visibility": "private"
    }
  ]
}
```

規則：

- project map 是 local/private 資料，不應 commit 到 public repo
- public repo 只能放 `project-map.example.json` 這類不含真實路徑的範例
- `repoPaths` 可以包含絕對路徑，但只存在本機或 private companion repo
- `notePath` 是相對於 Agent Notes vault 的路徑
- v0.1 預設單一 Agent Notes vault，多 vault support 放到 post-MVP

Phase 1 欄位契約：

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `version` | yes | integer | `1` |
| `vaultPath` | yes | string | local absolute path |
| `projects` | yes | array | 可空 |
| `projects[].id` | yes | string | slug，唯一 |
| `projects[].name` | yes | string | display name |
| `projects[].repoId` | yes | string | slug，唯一或可被查找 |
| `projects[].repoPaths` | yes | string[] | local absolute paths，不寫入 Markdown |
| `projects[].notePath` | yes | string | vault-relative path |
| `projects[].tags` | no | string[] | public-safe only |
| `projects[].visibility` | yes | enum | Phase 1 預設 `private` |

#### Team Project Catalog

Team Vault 不能依賴每位使用者的絕對 `repoPaths`。post-MVP 應拆成 tracked team catalog 與 per-user ignored binding：

```json
{
  "version": 1,
  "projects": [
    {
      "projectId": "example",
      "repoId": "example",
      "name": "Example",
      "notePath": "03-Projects/Example",
      "aliases": ["example-app"],
      "visibility": "team-safe"
    }
  ]
}
```

規則：

- Team project catalog 只保存 `projectId`、`repoId`、`name`、`notePath`、`aliases` 與 team-approved metadata
- Team project catalog 不得保存個人本機絕對路徑
- 每位使用者自己的 repo path binding 存在被忽略的 `.agent-notes/repo-bindings.json` 或 local config
- Team Vault 使用者應使用 `agent-notes project attach --repo "$PWD" --project-id <id>` 建立本機 binding
- `context --repo` 在 Team Vault 中先查本機 binding；找不到時回傳 `PROJECT_NOT_FOUND`，並提示使用 `project attach`
- `project add --repo` 在 personal vault 建立 local project map；Team Vault 的 tracked catalog 新增流程屬於 post-MVP，必須受 write policy 控制

#### Team Target Binding

每個 personal project 可對應一個或多個 Team Vault target。這份 mapping 屬於 local/private config，不應寫入 public repo，也不應寫入 shared Markdown。

```json
{
  "version": 1,
  "targets": [
    {
      "projectId": "example",
      "teamVaultId": "team-example",
      "teamVaultPath": "$HOME/Documents/Agent-Notes-Team",
      "teamNotePath": "03-Projects/Example",
      "promotionMode": "manual-pr",
      "writePolicy": "branch-pr"
    }
  ]
}
```

規則：

- `teamVaultPath` 是使用者本機 checkout 路徑，只能存在 local/private config
- `teamNotePath` 是相對於 Team Vault 的路徑，必須對應 Team project catalog 的 `notePath`
- `promotionMode` 可規劃為 `off | manual-pr | auto-pr-candidate`
- `off` 不產生 Team Vault candidate
- `manual-pr` 只在使用者或 agent 明確呼叫 `promote` 時產生 branch/PR handoff
- `auto-pr-candidate` 允許 hook 在通過 gating 後自動建立 candidate branch，但仍不得直接寫入 Team Vault main
- v0.1 不需要實作 Team target binding；若 config 出現 team target，應回傳 `FEATURE_UNSUPPORTED`

## Capture Contract

v0.1 的 capture protocol 採 deterministic input，不嘗試完美解析所有 transcript：

```bash
agent-notes capture --repo "$PWD" --tool codex --scope project --summary-file ./agent-summary.md
```

規則：

- `--scope` 可選，值為 `ignore | daily | inbox | area | personal | project`
- `--visibility` 可選，值為 `private | team-safe | public-safe`，預設 `private`
- `team-safe` 或 `public-safe` 只能由使用者明確指定，或由使用者預先允許的 project policy 指定；classification 不得自行升級 visibility
- 未提供 `--scope` 時，CLI 依 `--repo` 是否能解析 project map 做 deterministic routing
- `--scope project` 時，`--repo` 必填且必須解析到 project；失敗時回傳 `PROJECT_NOT_FOUND`
- `--scope` 為非 project 時，`--repo` 只作為本機 routing metadata，不寫入 session card frontmatter
- `--scope ignore` 不建立 session card，只輸出 routing result
- 除 `--scope ignore` 外，`--summary-file` 為必填，內容必須是 UTF-8 Markdown
- `--summary-file` 必須包含固定 headings：`Summary`、`Changes`、`Decisions`、`Validation`、`Next Steps`、`Handoff`
- headings 必須使用 level 2 Markdown heading，例如 `## Summary`
- headings 名稱與順序必須嚴格比對；大小寫不符時回傳 `INVALID_SUMMARY_FILE`
- `Summary` 必須有內容；其他 section 可空白，但 heading 必須存在
- 缺少必要 heading 或 `Summary` 空白時，回傳 `INVALID_SUMMARY_FILE`
- CLI 可在產生 session card 時保留空 section，但不得自行推測未提供的事實
- `--source-file` 可選，只建立本機 pointer，不複製原始 transcript
- `--include-raw` 不屬於 Phase 1；Phase 1 呼叫時回傳 `FEATURE_UNSUPPORTED`
- frontmatter 只存 opaque source ref，不存 `--source-file` 的絕對路徑
- opaque source ref 對應表存放在 vault 內被忽略的 `.agent-notes/source-index.json`
- raw copy、size limit、redaction warning 與覆寫防護屬 post-MVP 規格
- raw transcript 不得在 MVP 預設寫入 vault
- 若 `--visibility team-safe | public-safe` 但 sensitive scan 失敗，`capture` 必須回傳 `PRIVATE_DATA_RISK`
- 未提供 `--scope` 且 `--repo` 找不到 project 時，v0.1 personal vault 預設寫入 inbox，並提示使用 `agent-notes project add --repo "$PWD"`；Phase 4 Team Vault 則提示使用 `agent-notes project attach --repo "$PWD" --project-id <id>`

## Source Index Schema

Canonical schema 定義在 [`provenance.md`](provenance.md#source-index)。本檔只要求 schema validator 匯出 `sourceIndexSchema`，並使用同一份 fixture，避免 source index 形狀在多份文件分歧。

## Provenance Log Schema

Canonical schema 定義在 [`provenance.md`](provenance.md#provenance-log)。generated marker item 與 provenance entry 必須在同一 write batch 內完成；若無法保證 marker item 對應 provenance，該 marker update 必須 abort。

## Public-safe Gating

`team-safe` 與 `public-safe` 是 blocking gate，不是單純 warning。Phase 1 capture 在寫入前必須掃描即將寫入的 frontmatter、body 與 marker diff。

最小 blocking patterns：

- 本機絕對路徑，例如 `/Users/`、`/home/`、Windows drive path
- home path alias，例如 `$HOME`、`~`
- `.agent-notes/`、`private/`、`private/raw-sessions/`
- `.env`、`.npmrc`、credential file 名稱
- 常見 token/key pattern，例如 `sk-`、`ghp_`、`xox`、`AKIA`、`AIza`
- `sourceFilePath`、`repoPath`、`vaultPath`、`projectMapPath` 等 local pointer 欄位
- raw transcript content 或 raw transcript path

若命中 blocking pattern：

- `visibility=private`：允許寫入，但 `doctor` 應提示風險。
- `visibility=team-safe | public-safe`：回傳 `PRIVATE_DATA_RISK`，不得寫入 session card、marker block 或 team candidate。

## Fixture Requirements

Phase 1 至少需要以下 schema fixtures：

| Fixture | Expected |
| --- | --- |
| valid local config | parse OK |
| config with `sharing.mode=team` | `FEATURE_UNSUPPORTED` |
| config missing `vaultPath` | `CONFIG_INVALID` |
| valid empty project map | parse OK |
| project map with duplicate project id | `PROJECT_MAP_INVALID` |
| project map with absolute `notePath` | `PROJECT_MAP_INVALID` |
| valid project session frontmatter | parse OK |
| session frontmatter with absolute `repoPath` | invalid public-safe check |
| source index with malformed source key | invalid |
| provenance entry without `sourceRefs` | invalid |
| `team-safe` session body contains `/Users/example` | `PRIVATE_DATA_RISK` |
| `team-safe` marker diff contains `.env` | `PRIVATE_DATA_RISK` |
