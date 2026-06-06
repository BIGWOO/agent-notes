# Marker Block 規格

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 marker block updater 的 idempotent 更新策略與人工筆記保護規則。

---

## Marker Block 策略

Agent Notes 只能更新明確標記的 generated regions：

```markdown
<!-- agent-notes:start active-tasks -->
Generated content.
<!-- agent-notes:end active-tasks -->
```

規則：

- 不重寫 marker block 外的人工內容
- 保留未知內容
- marker block 格式異常時安全失敗
- v0.1 只允許從 summary-file 的明確 sections 更新 generated blocks，例如從 `Next Steps` 更新 active tasks，從 `Decisions` 更新 decision log
- 不從自由文字推論新任務、決策或風險
- 每個 generated item 必須有穩定 item id 與 `sourceRefs`
- 更新既有 generated item 時必須保留 item id，不可因重新生成而換 id
- 無 sourceRefs 的 generated item 不得寫入 marker block
- dry-run 只輸出 unified diff，不寫檔
- 所有實際 marker write 都必須先建立 backup
- backup 放在被 vault `.gitignore` 排除的 `.agent-notes/backups/`
- backup 保留策略預設至少保留最近 20 份或最近 7 天
- 寫入前取得 single-writer lock，避免多個 agent hook 同時更新同一檔案
- 寫入使用 temporary file + atomic rename
- 寫入前後檢查檔案 mtime 或 content hash，偵測到競態變更時停止
- 目標檔案有未解決 conflict marker 時停止
- backup 建立失敗時不得寫入目標檔案，並回傳 `BACKUP_FAILED`
- 其他失敗時回傳可機器判讀的 exit code，例如 `MARKER_MISSING`、`MARKER_INVALID`、`WRITE_CONFLICT`

## Marker Grammar

Phase 1 marker block 只接受單層 block，不支援巢狀 marker：

```markdown
<!-- agent-notes:start <block-id> -->
<generated markdown>
<!-- agent-notes:end <block-id> -->
```

`block-id` 規則：

- 只允許小寫英數、`-`，例如 `active-tasks`、`decision-log`、`pitfalls`。
- start / end id 必須完全一致。
- 同一檔案不得出現重複 `block-id`。
- marker 之間的人工內容必須原樣保留。

Phase 1 必要 block：

| File | Block ID | Source Section | Item Prefix |
| --- | --- | --- | --- |
| `03-context/active-tasks.md` | `active-tasks` | `Next Steps` | `TASK` |
| `03-context/decision-log.md` | `decision-log` | `Decisions` | `DEC` |
| `03-context/pitfalls.md` | `pitfalls` | optional future input | `PIT` |
| `03-context/README.md` | `project-summary` | `Summary` | `CTX` |

## Update Algorithm

Updater 必須採 deterministic algorithm：

1. 讀取目標檔案與 content hash。
2. 檢查 conflict markers：`<<<<<<<`、`=======`、`>>>>>>>`，命中即回傳 `WRITE_CONFLICT`。
3. 解析 marker blocks；缺必要 block 回傳 `MARKER_MISSING`。
4. 驗證 start / end pairing、id uniqueness 與 no nesting；失敗回傳 `MARKER_INVALID`。
5. 從 summary-file 對應 section 產生 candidate items。
6. 讀取現有 generated block，建立 `itemFingerprint` 到 item id 的對照。
7. 對 fingerprint 完全相同的 generated item 保留 item id；不做 semantic matching。
8. 對新 item 產生下一個可用 id，例如 `TASK-0002`。
9. 每個 item 必須帶 `sourceRefs`；缺來源不得寫入。
10. `--dry-run` 產生 unified diff 後停止。
11. 寫入前建立 backup；失敗回傳 `BACKUP_FAILED`。
12. 取得 single-writer lock。
13. 重新讀取目標檔案，比對 content hash；不同則回傳 `WRITE_CONFLICT`。
14. 準備 marker target temp file 與 provenance log temp/append plan。
15. 在同一 write batch 內完成 marker target 與 provenance log 寫入；若任一寫入失敗，使用 backup rollback，最終不得留下「有 marker item 但無 provenance」的狀態。

## Generated Item Format

Phase 1 使用簡單 Markdown list，避免過早引入複雜資料庫格式：

```markdown
- TASK-0001 | 完成 init state machine
  - status: planned
  - sourceRefs: src_20260606_codex_001
```

規則：

- 第一行格式固定為 `- <ITEM-ID> | <title>`。
- metadata lines 使用兩個空白縮排加 `- key: value`。
- `sourceRefs` 可用逗號分隔多個 ref。
- `itemFingerprint` 使用 `itemType + sourceSection + normalizedTitle`；`normalizedTitle` 只做 trim、連續空白折疊與大小寫正規化。
- 人工修改 generated block 內 item title 時，fingerprint 會改變；updater 應保留舊 item 並新增新 item，不做模糊合併。
- `project-summary` 也使用 generated item 格式，item id 前綴為 `CTX`；context packet 只讀取最新一筆 `CTX-*` summary。

## Edge Cases

| Case | Expected |
| --- | --- |
| 缺 start marker | `MARKER_MISSING` |
| 缺 end marker | `MARKER_INVALID` |
| start / end id 不一致 | `MARKER_INVALID` |
| 巢狀 marker | `MARKER_INVALID` |
| 同一檔案重複 block id | `MARKER_INVALID` |
| 檔案含 Git conflict marker | `WRITE_CONFLICT` |
| backup 無法建立 | `BACKUP_FAILED` |
| 寫入前 content hash 改變 | `WRITE_CONFLICT` |
| summary section 空白 | 不更新對應 block |
| item 缺 sourceRefs | 不寫入並回傳 `PROVENANCE_ORPHAN` |
| provenance write 失敗 | rollback marker write，回傳 `WRITE_CONFLICT` |

## Minimal Fixture Set

Phase 1 marker tests 至少包含：

- valid empty block -> insert generated item
- valid existing item -> preserve item id
- changed title -> preserve old item and create new item
- dry-run -> produces diff and leaves file unchanged
- manual text outside marker -> byte-for-byte preserved
- invalid marker pairing -> `MARKER_INVALID`
- missing required block -> `MARKER_MISSING`
- conflict marker present -> `WRITE_CONFLICT`
- provenance append failure -> `WRITE_CONFLICT` and leaves no marker item without provenance
