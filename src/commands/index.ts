import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";

export function registerCommands(program: Command): void {
  program
    .command("init")
    .description("建立新的 Agent Notes vault 與本機設定")
    .option("--yes", "使用非互動模式確認必要步驟")
    .option("--lang <locale>", "指定介面語言，例如 en 或 zh-TW")
    .option("--vault-path <path>", "指定 vault 建立位置")
    .option("--no-integrations", "略過 agent integration 設定")
    .option("--no-project", "略過第一個 project 設定")
    .option("--project-repo <path>", "指定第一個 project repo")
    .option("--allow-git-worktree-vault", "允許在 Git worktree 內建立 vault")
    .option("--resume", "恢復未完成的 init")
    .option("--rollback", "回復未完成的 init")
    .option("--dry-run", "只顯示 write plan，不寫入檔案")
    .action(notImplemented("init"));

  registerProjectCommands(program);
  registerCaptureCommand(program);
  registerContextCommand(program);
  registerDoctorCommand(program);
  registerTraceCommand(program);
  registerIntegrateCommand(program);
}

function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("管理 local/private project map");

  project
    .command("add")
    .description("把 repo 加入 project map")
    .requiredOption("--repo <path>", "repo 路徑")
    .option("--name <name>", "project 顯示名稱")
    .option("--project-id <id>", "指定 project id")
    .option("--dry-run", "只顯示 write plan，不寫入檔案")
    .action(notImplemented("project add"));

  project
    .command("list")
    .description("列出已知 projects")
    .option("--repo <path>", "標示指定 repo 是否已匹配 project")
    .action(notImplemented("project list"));

  project
    .command("check")
    .description("檢查 repo 是否可解析到 project")
    .option("--repo <path>", "repo 路徑，未提供時使用目前工作目錄")
    .action(notImplemented("project check"));

  project.action(() => {
    project.outputHelp();
  });
}

function registerCaptureCommand(program: Command): void {
  program
    .command("capture")
    .description("依 summary file 建立 session note 與 provenance")
    .option("--repo <path>", "repo 路徑")
    .option("--tool <tool>", "agent tool，例如 codex")
    .option("--scope <scope>", "寫入範圍：ignore、inbox、daily、area、personal、project")
    .option("--summary-file <path>", "deterministic Markdown summary file")
    .option("--visibility <visibility>", "visibility：private、team-safe、public-safe")
    .option("--source-file <path>", "本機 source pointer，不複製 raw transcript")
    .option("--dry-run", "只顯示 write plan，不寫入檔案")
    .action(notImplemented("capture"));
}

function registerContextCommand(program: Command): void {
  program
    .command("context")
    .description("輸出 bounded project context packet")
    .option("--repo <path>", "repo 路徑")
    .option("--max-chars <count>", "輸出字元上限")
    .action(notImplemented("context"));
}

function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("檢查 config、vault、project map、provenance 與 public-safe 風險")
    .option("--check <name>", "只執行指定檢查")
    .option("--json", "輸出 JSON")
    .action(notImplemented("doctor"));
}

function registerTraceCommand(program: Command): void {
  program
    .command("trace")
    .description("追溯 itemId、sessionId 或 sourceRef")
    .argument("<id>", "itemId、sessionId 或 sourceRef")
    .option("--json", "輸出 JSON")
    .action(notImplemented("trace"));
}

function registerIntegrateCommand(program: Command): void {
  const integrate = program.command("integrate").description("檢查或設定 agent integration");

  integrate
    .option("--list", "列出 integration 支援狀態")
    .action((options: { readonly list?: boolean }) => {
      if (options.list === true) {
        process.stdout.write(
          [
            "codex: planned for Phase 1 dry-run/apply",
            "claude-code: coming soon",
            "openclaw: coming soon"
          ].join("\n") + "\n"
        );
        return;
      }

      integrate.outputHelp();
    });

  integrate
    .command("codex")
    .description("檢查或套用 Codex hook integration")
    .option("--dry-run", "顯示 planned patch，不寫入檔案")
    .option("--apply", "套用 Codex integration")
    .option("--binary <path>", "指定穩定 agent-notes binary path")
    .option("--yes", "略過互動確認")
    .action(notImplemented("integrate codex"));
}

function notImplemented(commandName: string): () => never {
  return () => {
    throw new AgentNotesError(
      ErrorCode.FEATURE_UNSUPPORTED,
      `${commandName} 尚未實作；目前已建立 CLI scaffold，後續依 Phase 1 workstream 補齊。`
    );
  };
}
