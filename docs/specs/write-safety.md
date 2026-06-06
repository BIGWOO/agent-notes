# Write Safety 規格

Status: draft
Last Updated: 2026-06-06
Source: Phase 1 implementation planning

本檔定義 Phase 1 寫檔 command 共用的 lock、backup、atomic write 與 rollback 契約。目標是簡單、可測試、可回復；不做分散式鎖或跨機器同步。

---

## Scope

適用 command：

- `init`
- `project add`
- `capture`
- `integrate codex --apply`

不適用 command：

- `project list`
- `project check`
- `context`
- `doctor`
- `trace`
- `integrate --list`
- `integrate codex --dry-run`

## Write Batch Contract

所有會寫檔的 command 都必須先建立 write plan，再進入 write batch。

Write plan 必須包含：

- `operationId`
- `command`
- `filesToCreate`
- `filesToModify`
- `filesToSkip`
- `publicSafeScanTargets`
- `rollbackPlan`

共用流程：

1. 載入 config 與必要 schema。
2. 解析 command input。
3. 建立完整 write plan。
4. 執行必要 validation 與 public-safe gate。
5. 取得 lock。
6. 對即將修改的既有檔案建立 backup。
7. 對每個目標檔案寫入同目錄 temp file。
8. 使用 atomic rename 取代目標檔案。
9. log files 例如 provenance log 必須用 read-copy-append-rename 準備新檔；若寫入失敗，整個 batch 回 rollback。
10. 回傳實際寫入、略過與 warning summary。
11. 無論成功或失敗，都必須釋放本次 command 建立的 lock。

`--dry-run` 只執行到 step 4，並輸出 write plan；不得建立 lock、backup、temp file 或 init-state。

## Lock

Phase 1 使用 local filesystem lock。

規則：

- lock 檔放在 vault `.agent-notes/locks/`；`init` 在 vault 建立前使用 local config dir 的 `init-state.json` 作為互斥狀態來源。
- lock filename 使用 command scope，例如 `capture.lock`、`project-map.lock`、`integration-codex.lock`。
- lock acquisition 使用 exclusive create；失敗時回 `WRITE_CONFLICT`。
- lock content 至少包含 `operationId`、`command`、`createdAt`、`pid`。
- command 只能刪除自己建立且 `operationId` 相符的 lock。
- 成功寫入後必須刪除本次 lock。
- 寫入失敗或 rollback 後，也必須在 finally step 刪除本次 lock。
- Phase 1 不自動移除其他程序留下的 stale lock；若 lock 看似過期，只提示使用者檢查程序後手動移除。
- 若本次 lock 刪除失敗，command 輸出 warning 與 lock path；已成功的 write batch 不因此改成失敗，但下一次寫入可能回 `WRITE_CONFLICT`。

## Backup

規則：

- 修改 tracked vault files 前，必須先備份原檔。
- vault backup 放在被 `.gitignore` 排除的 `.agent-notes/backups/<operationId>/`。
- backup path 保留 vault-relative 結構，例如 `03-Projects/Example/03-context/active-tasks.md`。
- 新建檔案不需要 backup，但 rollback plan 必須能刪除本次新建檔案。
- backup 建立失敗回 `BACKUP_FAILED`，不得寫入目標檔案。
- `integrate codex --apply` 修改的是 agent local config，backup 應放在該 agent config 相鄰或 Agent Notes local config dir，不得放進 tracked vault。

## Atomic Write

規則：

- temp file 必須與目標檔案在同一目錄，避免跨 filesystem rename。
- temp filename 使用 `.<basename>.<operationId>.tmp`。
- 寫入 temp file 後再 rename 到目標檔案。
- 寫入前若目標檔案 hash 與 planning 時不同，回 `WRITE_CONFLICT`。
- 任一檔案寫入失敗時，必須依 rollback plan 還原已改動檔案。
- rollback 失敗時仍回原始錯誤碼，並輸出 manual recovery path；不得宣稱成功。

## Indexed and Log Files

`source-index.json` 與 `provenance.jsonl` 是 write batch 的一部分，不可在 marker block 之後才獨立嘗試。

規則：

- `source-index.json` 使用 read-modify-write，必須受同一 lock 保護。
- `provenance.jsonl` 維持 logical append-only：新 entries 只能加在既有 entries 後面，不得修改既有內容。
- 實體寫入使用 read-copy-append-rename：讀取既有 log、附加 planned entries、寫入同目錄 temp file，再 atomic rename。
- rename 前先驗證每筆 JSON object 可序列化且 `sourceRefs` 不為空。
- 若 marker item 寫入成功但 provenance log temp write 或 rename 失敗，rollback 後最終狀態不得留下無 provenance 的 generated item。
- 若 rollback 無法保證一致性，command 回 `WRITE_CONFLICT` 並提示執行 `doctor --check provenance`。

## Acceptance Cases

| Case | Expected |
| --- | --- |
| dry-run write command | no lock、no backup、no temp file、no writes |
| lock exists | `WRITE_CONFLICT`，no writes |
| successful write | target files updated and own lock removed |
| failed write with rollback | target files restored and own lock removed |
| backup path not writable | `BACKUP_FAILED`，no writes |
| target hash changed before write | `WRITE_CONFLICT`，no writes |
| temp write fails after one file changed | rollback restored previous file |
| provenance log temp write fails | rollback marker write，回 `WRITE_CONFLICT` |
| integration backup succeeds but patch fails | backup kept，original config restored or unchanged |
