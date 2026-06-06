# ADR-0001: Runtime 採用 Node.js + TypeScript

Status: accepted
Date: 2026-06-06
Source: [`../architecture/runtime.md`](../architecture/runtime.md)

## Context

Agent Notes 是 local-first CLI，需要能跨 macOS、Linux、Windows 執行，並與 npm / npx 安裝流程自然銜接。MVP 需要穩定處理檔案系統、Markdown、YAML frontmatter、CLI prompt、JSON schema validation 與 agent hook integration。

## Decision

MVP runtime 採用 Node.js + TypeScript。CLI command、schema key、檔名與 API 可維持英文；文件、註解與使用者提示優先支援繁體中文，同時保留英文預設語言。

## Consequences

- npm / npx 安裝門檻低，適合小白用戶與 agent hook 使用。
- TypeScript 可讓 config、project map、frontmatter、error code contract 更容易型別化。
- Obsidian CLI 只能是 optional integration，核心 runtime 直接讀寫 Markdown、YAML frontmatter 與 marker block。
- 需要在 `init` 與 `doctor` 檢查 Node.js runtime 版本，並以 `RUNTIME_UNSUPPORTED` 回報不支援環境。

## Alternatives Considered

- Python：檔案與文字處理成熟，但 npm/npx onboarding 與 agent hook 安裝直覺性較弱。
- Shell script：啟動成本低，但 schema validation、跨平台 path handling 與測試維護成本較高。
