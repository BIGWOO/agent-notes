# Capture Pipeline 架構

Status: draft
Last Updated: 2026-06-06
Source: 從 `docs/PRD.md` 拆分整理

本檔定義 capture command 從 summary file 到 session card 與 context marker 更新的流程。

---

## Capture Pipeline

```mermaid
flowchart TD
    A["capture command"] --> B["Load config and project map"]
    B --> C["Resolve repo if provided"]
    C --> D["Determine scope"]
    D --> E{"scope"}

    E -->|ignore| F["Output routing result only"]
    E -->|inbox/daily/area/personal| G["Resolve non-project destination"]
    E -->|project| H["Require projectId and repoId"]

    G --> I["Validate summary-file"]
    H --> I
    I --> J["Create session card"]
    J --> K["Store opaque source ref"]
    K --> K1["Write provenance entries"]
    K1 --> L{"include raw?"}
    L -->|yes| M["Copy to ignored private/raw-sessions"]
    L -->|no| N["Skip raw copy"]
    M --> O["Optional deterministic marker updates"]
    N --> O
    O --> P["Lock, backup, atomic write"]
    P --> Q["Return paths and exit code"]
```

規則：

- `--scope ignore` 不讀寫 session card
- `--scope project` 必須成功解析 project map
- 未提供 `--scope` 時，repo resolution 成功才走 project，失敗則走 inbox
- `summary-file` 驗證必須早於任何寫入
- source path 只寫入 `.agent-notes/source-index.json`，session card 只存 opaque ref
- `--include-raw` 才能複製 raw，且目的地固定在被忽略的 `private/raw-sessions/`
- marker updates 只能使用 summary-file 的明確 sections，不做 LLM 推論
- decisions、tasks、context updates 寫入 marker 前必須先產生 provenance entry
- 寫入 session card、source index、raw copy、marker block 前都必須遵守 lock / backup / atomic write 規則
