import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { registerCaptureCommand } from "./capture.js";
import { registerContextCommand } from "./context.js";
import { registerDoctorCommand } from "./doctor.js";
import { registerInitCommand } from "./init.js";
import { registerIntegrateCommands } from "./integrate.js";
import { registerProjectCommands } from "./project.js";
import { registerTraceCommand } from "./trace.js";

export function registerCommands(program: Command): void {
  registerInitCommand(program);
  registerProjectCommands(program);
  registerCaptureCommand(program);
  registerContextCommand(program);
  registerDoctorCommand(program);
  registerTraceCommand(program);
  registerIntegrateCommands(program);
  registerPostMvpCommands(program);
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
