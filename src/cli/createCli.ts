import { Command, CommanderError, type OutputConfiguration } from "commander";
import { registerCommands } from "../commands/index.js";
import { AgentNotesError, ErrorCode, exitCodeFor } from "../core/errors.js";
import { readPackageVersion } from "../core/packageInfo.js";

export interface CreateCliOptions {
  readonly output?: OutputConfiguration;
  readonly exitOverride?: boolean;
  readonly version?: string;
}

export function createCli(options: CreateCliOptions = {}): Command {
  const program = new Command();

  program
    .name("agent-notes")
    .description("Agent Notes local-first Markdown vault CLI")
    .version(options.version ?? readPackageVersion(), "-v, --version", "顯示版本")
    .helpOption("-h, --help", "顯示說明")
    .showHelpAfterError("(可使用 --help 查看可用選項)")
    .configureHelp({
      sortSubcommands: true
    });

  if (options.output) {
    program.configureOutput(options.output);
  }

  if (options.exitOverride) {
    program.exitOverride();
  }

  registerCommands(program);

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = createCli();

  try {
    if (argv.length <= 2) {
      program.outputHelp();
      return;
    }

    await program.parseAsync([...argv], {
      from: "node"
    });
  } catch (error) {
    if (error instanceof CommanderError) {
      throw error;
    }

    if (error instanceof AgentNotesError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }

    const unknown = error instanceof Error ? error.message : "未知錯誤";
    process.stderr.write(`${ErrorCode.UNKNOWN_ERROR}: ${unknown}\n`);
    process.exitCode = exitCodeFor(ErrorCode.UNKNOWN_ERROR);
  }
}
