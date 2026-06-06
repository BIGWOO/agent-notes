# Templates 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 MVP 會建立或讀取的 Markdown templates。

---

## MVP Templates

MVP 必須內建 public-safe templates。`init` 建立新 vault 時，應產生標準模板檔；`capture` 與 `project add` 應使用同一組模板，不允許各 agent 自行拼 Markdown。

## Vault `.gitignore`

```gitignore
private/
.agent-notes/
.DS_Store
```

## Summary File Template

Agent 或使用者提供給 `capture --summary-file` 的檔案必須符合此格式：

```markdown
## Summary

## Changes

## Decisions

## Validation

## Next Steps

## Handoff
```

規則：

- headings 必須完整、順序固定、大小寫固定
- `Summary` 必須有內容
- headings 是 machine contract，所有 locale 的 template 都必須保留英文 heading
- localized template 只能翻譯註解、placeholder 或提示文字，不得翻譯 heading 名稱
- 其他 sections 可空白
- 不允許在 template 內放 secret、token、channel id、真實客戶敏感資訊或私有 repo mapping

## Session Card Template

```markdown
---
type: agent-session
schemaVersion: 1
title: "{{title}}"
date: "{{date}}"
agent: "{{agent}}"
tool: "{{tool}}"
scope: "{{scope}}"
status: "{{status}}"
visibility: private
source:
  kind: "{{sourceKind}}"
  ref: "{{sourceRef}}"
  rawIncluded: false
sourceRefs:
  - "{{sourceRef}}"
derivedItems:
  decisions: []
  tasks: []
  contextUpdates: []
tags:
  - session
---

# {{title}}

## Summary

{{summary}}

## Changes

{{changes}}

## Decisions

{{decisions}}

## Validation

{{validation}}

## Next Steps

{{nextSteps}}

## Handoff

{{handoff}}

## Source

{{sourceSummary}}
```

`scope: project` 的 session card 需額外加入：

```yaml
projectId: "{{projectId}}"
project: "{{projectName}}"
repoId: "{{repoId}}"
```

## Project Context Templates

`project add` 建立 project 目錄時，至少建立以下 context files：

```markdown
# {{projectName}}

Manual notes live outside generated blocks.

<!-- agent-notes:start project-summary -->
<!-- agent-notes:end project-summary -->
```

```markdown
# Active Tasks

Manual notes live outside generated blocks.

<!-- agent-notes:start active-tasks -->
- TASK-0001 | Example task title
  - status: planned
  - sourceRefs: src_example_001
<!-- agent-notes:end active-tasks -->
```

```markdown
# Decision Log

Manual notes live outside generated blocks.

<!-- agent-notes:start decision-log -->
- DEC-0001 | Example decision title
  - status: accepted
  - sourceRefs: src_example_001
<!-- agent-notes:end decision-log -->
```

```markdown
# Pitfalls

Manual notes live outside generated blocks.

<!-- agent-notes:start pitfalls -->
<!-- agent-notes:end pitfalls -->
```

規則：

- marker block 外的文字視為人工內容，不得自動覆蓋
- generated block 初始可為空；範例 item 只作為格式說明，實際 template 可不預填
- generated item 必須包含 item id 與 `sourceRefs`
- 檔名固定為 `README.md`、`active-tasks.md`、`decision-log.md`、`pitfalls.md`
