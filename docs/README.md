# Agent Notes Docs

Status: planning
Last Updated: 2026-06-06

本目錄保存 Agent Notes 的 public-safe 產品規劃、規格、架構與實作進度。`PRD.md` 是入口索引；實作時應優先閱讀對應 `specs/` 與 `implementation/` 文件。

## 閱讀順序

1. [`PRD.md`](PRD.md)：產品入口與文件索引
2. [`product/vision.md`](product/vision.md)：確認產品邊界
3. [`implementation/progress.md`](implementation/progress.md)：確認目前進度
4. 對應 workstream 的 `specs/` 與 `architecture/` 文件
5. [`implementation/scenario-matrix.md`](implementation/scenario-matrix.md)：模擬使用情境並檢查規格覆蓋
6. [`implementation/validation.md`](implementation/validation.md)：確認驗收與測試

## 文件分類

```text
docs/
├── PRD.md
├── README.md
├── product/
│   ├── vision.md
│   ├── users-and-use-cases.md
│   └── roadmap.md
├── specs/
│   ├── cli.md
│   ├── init-onboarding.md
│   ├── vault-structure.md
│   ├── schemas.md
│   ├── provenance.md
│   ├── marker-blocks.md
│   ├── write-safety.md
│   ├── integrations.md
│   ├── team-sharing.md
│   ├── templates.md
│   └── error-codes.md
├── architecture/
│   ├── runtime.md
│   ├── capture-pipeline.md
│   └── context-pipeline.md
├── implementation/
│   ├── phase-1-plan.md
│   ├── progress.md
│   ├── scenario-matrix.md
│   ├── validation.md
│   └── open-questions.md
└── decisions/
    └── ADR-0001-runtime-node-typescript.md
```

## 維護規則

- PRD 只保留產品入口與索引，不再塞完整規格。
- `specs/` 是 command behavior、schema 與可測試契約的主要真相來源。
- `architecture/` 說明 runtime 與 pipeline 設計。
- `implementation/progress.md` 是階段追蹤入口。
- 重大不可輕易改動的決策寫入 `decisions/ADR-*.md`。
- 所有 public 文件都必須 public-safe。
