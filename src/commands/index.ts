import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { registerInitCommand } from "./init.js";
import { registerProjectCommands } from "./project.js";

export function registerCommands(program: Command): void {
  registerInitCommand(program);
  registerProjectCommands(program);
  registerCaptureCommand(program);
  registerContextCommand(program);
  registerDoctorCommand(program);
  registerTraceCommand(program);
  registerIntegrateCommand(program);
  registerPostMvpCommands(program);
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

function registerPostMvpCommands(program: Command): void {
  const plannedCommands = ["rollup", "classify", "sync", "promote", "publish"] as const;

  for (const commandName of plannedCommands) {
    program
      .command(commandName)
      .allowUnknownOption()
      .allowExcessArguments()
      .description("post-MVP command，Phase 1 尚未支援")
      .action(notImplemented(commandName));
  }
}

function notImplemented(commandName: string): () => never {
  return () => {
    throw new AgentNotesError(
      ErrorCode.FEATURE_UNSUPPORTED,
      `${commandName} 尚未實作；目前已建立 CLI scaffold，後續依 Phase 1 workstream 補齊。`
    );
  };
}
