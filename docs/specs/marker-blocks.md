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
