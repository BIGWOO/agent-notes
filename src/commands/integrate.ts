import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { resolvePath, type PathOptions } from "../core/paths.js";
import {
  createOperationId,
  executeWriteBatch,
  prepareWriteBatch,
  type PreparedWriteBatch,
  type WriteBatchResult
} from "../core/writeSafety.js";

interface IntegrateListOptions {
  readonly list?: boolean;
}

interface IntegrateCodexOptions {
  readonly dryRun?: boolean;
  readonly apply?: boolean;
  readonly binary?: string;
  readonly yes?: boolean;
}

export interface IntegrateContext extends PathOptions {
  readonly operationId?: string;
  readonly stdout?: (value: string) => void;
}

export interface IntegrationStatus {
  readonly agent: "codex" | "claude-code" | "openclaw";
  readonly status: "supported" | "not-found" | "unsupported" | "coming-soon";
  readonly message: string;
}

export interface IntegrateListResult {
  readonly integrations: readonly IntegrationStatus[];
}

export interface IntegrateCodexResult {
  readonly batch: PreparedWriteBatch;
  readonly configSummary: string;
  readonly hookCommand: string;
  readonly mode: "dry-run" | "applied";
  readonly result: WriteBatchResult;
  readonly stableBinary: string;
  readonly backupRootSummary: string;
}

interface RecognizedCodexConfig {
  readonly config: Record<string, unknown>;
  readonly configPath: string;
}

const codexConfigFileName = "config.json";
const codexHookCommandTemplate = 'capture --tool codex --scope inbox --summary-file "$AGENT_NOTES_SUMMARY_FILE"';

export function registerIntegrateCommands(program: Command): void {
  const integrate = program.command("integrate").description("檢查或設定 agent integration");

  integrate
    .option("--list", "列出 integration 支援狀態")
    .action((options: IntegrateListOptions) => {
      if (options.list === true) {
        runIntegrateListCommand();
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
    .action(async (options: IntegrateCodexOptions) => {
      await runIntegrateCodexCommand(options);
    });
}

export function runIntegrateListCommand(context: IntegrateContext = {}): IntegrateListResult {
  const result = runIntegrateList(context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatIntegrateListResult(result));

  return result;
}

export function runIntegrateList(context: IntegrateContext = {}): IntegrateListResult {
  return {
    integrations: [
      codexStatus(context),
      {
        agent: "claude-code",
        status: "coming-soon",
        message: "coming soon"
      },
      {
        agent: "openclaw",
        status: "coming-soon",
        message: "coming soon"
      }
    ]
  };
}

export async function runIntegrateCodexCommand(
  options: IntegrateCodexOptions,
  context: IntegrateContext = {}
): Promise<IntegrateCodexResult> {
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  try {
    const result = await runIntegrateCodex(options, context);

    output(formatIntegrateCodexResult(result));

    return result;
  } catch (error) {
    if (options.dryRun === true && error instanceof AgentNotesError && error.code === ErrorCode.INTEGRATION_UNSUPPORTED) {
      output(formatCodexManualInstructions(stableBinaryFor(options.binary, "dry-run")));
    }

    throw error;
  }
}

export async function runIntegrateCodex(
  options: IntegrateCodexOptions,
  context: IntegrateContext = {}
): Promise<IntegrateCodexResult> {
  if (options.dryRun === true && options.apply === true) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "integrate codex 不能同時使用 --dry-run 與 --apply");
  }

  const mode = options.apply === true ? "applied" : "dry-run";

  if (mode === "applied" && options.yes !== true) {
    throw new AgentNotesError(ErrorCode.NON_INTERACTIVE_REQUIRED, "integrate codex --apply 需要 --yes 明確確認");
  }

  const stableBinary = stableBinaryFor(options.binary, mode);
  const hookCommand = `${stableBinary} ${codexHookCommandTemplate}`;
  const codexHomePath = codexHome(context);
  const recognized = loadRecognizedCodexConfig(codexHomePath);
  const nextConfig = codexConfigWithHook(recognized.config, hookCommand);
  const operationId = context.operationId ?? createOperationId("integrate-codex");
  const backupRootPath = path.join(codexHomePath, "backups", "agent-notes", operationId);
  const batch = prepareWriteBatch({
    command: "integrate-codex",
    operationId,
    writes: [
      {
        targetPath: recognized.configPath,
        content: `${JSON.stringify(nextConfig, null, 2)}\n`,
        backupKey: codexConfigFileName
      }
    ]
  });
  const writeResult =
    mode === "dry-run"
      ? {
          operationId,
          written: [],
          skipped: batch.plan.filesToSkip,
          warnings: []
        }
      : await executeWriteBatch({
          batch,
          lockFilePath: path.join(codexHomePath, ".agent-notes", "integrate-codex.lock"),
          backupRootPath
        });

  return {
    batch,
    configSummary: localFileSummary(recognized.configPath),
    hookCommand,
    mode,
    result: writeResult,
    stableBinary,
    backupRootSummary: path.posix.join("backups", "agent-notes", operationId)
  };
}

function codexStatus(context: IntegrateContext): IntegrationStatus {
  try {
    loadRecognizedCodexConfig(codexHome(context));

    return {
      agent: "codex",
      status: "supported",
      message: "recognized config"
    };
  } catch (error) {
    if (error instanceof AgentNotesError && error.code === ErrorCode.INTEGRATION_NOT_FOUND) {
      return {
        agent: "codex",
        status: "not-found",
        message: "config not found"
      };
    }

    return {
      agent: "codex",
      status: "unsupported",
      message: "unrecognized config shape"
    };
  }
}

function loadRecognizedCodexConfig(codexHomePath: string): RecognizedCodexConfig {
  const configPath = path.join(codexHomePath, codexConfigFileName);

  if (!existsSync(configPath)) {
    throw new AgentNotesError(ErrorCode.INTEGRATION_NOT_FOUND, "找不到 Codex config；請先確認 CODEX_HOME 或 ~/.codex");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new AgentNotesError(ErrorCode.INTEGRATION_UNSUPPORTED, "Codex config 不是 Phase 1 支援的 JSON fixture");
  }

  if (!isRecord(parsed) || !isRecognizedCodexConfig(parsed)) {
    throw new AgentNotesError(ErrorCode.INTEGRATION_UNSUPPORTED, "Codex config shape 不在 Phase 1 支援清單");
  }

  return {
    config: parsed,
    configPath
  };
}

function isRecognizedCodexConfig(value: Record<string, unknown>): boolean {
  if (typeof value.model !== "string" || !isRecord(value.hooks)) {
    return false;
  }

  const allowedRootKeys = new Set(["model", "model_provider", "approval_policy", "sandbox_mode", "hooks"]);
  const hasOnlyKnownRootKeys = Object.keys(value).every((key) => allowedRootKeys.has(key));
  const stopHook = value.hooks.stop;

  return hasOnlyKnownRootKeys && (stopHook === undefined || (Array.isArray(stopHook) && stopHook.every((entry) => typeof entry === "string")));
}

function codexConfigWithHook(config: Record<string, unknown>, hookCommand: string): Record<string, unknown> {
  const hooks = isRecord(config.hooks) ? config.hooks : {};
  const stopHook = Array.isArray(hooks.stop) ? hooks.stop.filter((entry): entry is string => typeof entry === "string") : [];
  const nextStopHook = stopHook.includes(hookCommand) ? stopHook : [...stopHook, hookCommand];

  return {
    ...config,
    hooks: {
      ...hooks,
      stop: nextStopHook
    }
  };
}

function stableBinaryFor(binaryInput: string | undefined, mode: "dry-run" | "applied"): string {
  const binary = binaryInput?.trim() || "agent-notes";
  const hasExplicitBinary = binaryInput !== undefined && binaryInput.trim() !== "";
  const hasPathSeparator = binary.includes("/") || binary.includes("\\");

  if (
    binary === "" ||
    binary.includes("\0") ||
    (mode === "applied" && (!hasExplicitBinary || !path.isAbsolute(binary))) ||
    (hasPathSeparator && !path.isAbsolute(binary)) ||
    isEphemeralBinary(binary) ||
    /[\s;&|`$<>(){}[\]!*?'"\\]/u.test(binary)
  ) {
    throw new AgentNotesError(
      ErrorCode.INTEGRATION_BINARY_UNSTABLE,
      "hook command 需要 stable agent-notes binary；請使用 global install 或 --binary 指定固定路徑"
    );
  }

  return binary;
}

function isEphemeralBinary(binary: string): boolean {
  const normalized = binary.replaceAll("\\", "/").toLowerCase();
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const command = tokens[0] ?? "";
  const commandName = path.posix.basename(command);
  const subcommand = tokens[1] ?? "";

  return (
    commandName === "npx" ||
    commandName === "_npx" ||
    commandName === "bunx" ||
    (commandName === "npm" && (subcommand === "exec" || subcommand === "x")) ||
    (commandName === "pnpm" && subcommand === "dlx") ||
    (commandName === "yarn" && subcommand === "dlx") ||
    (commandName === "corepack" && tokens[1] === "pnpm" && tokens[2] === "dlx") ||
    /(?:^|\/)node_modules\/\.bin(?:\/|$)/u.test(normalized)
  );
}

function codexHome(context: IntegrateContext): string {
  return resolvePath(context.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? "~/.codex", context);
}

function formatIntegrateListResult(result: IntegrateListResult): string {
  return `${result.integrations.map((integration) => `${integration.agent}: ${integration.status} (${integration.message})`).join("\n")}\n`;
}

function formatIntegrateCodexResult(result: IntegrateCodexResult): string {
  const lines = [
    `codex: ${result.mode}`,
    `config: ${result.configSummary}`,
    `binary: ${result.stableBinary}`,
    `hookCommand: ${result.hookCommand}`,
    `filesToModify: ${result.batch.plan.filesToModify.length}`,
    `filesToBackup: ${result.batch.plan.rollbackPlan.modified.length}`,
    `backupRoot: ${result.backupRootSummary}`,
    result.mode === "dry-run" ? "no files written" : `written: ${result.result.written.length}`,
    result.mode === "dry-run" ? "recovery: no changes were applied" : "next: agent-notes doctor"
  ];

  return `${lines.join("\n")}\n`;
}

function formatCodexManualInstructions(stableBinary: string): string {
  return [
    "codex: unsupported",
    "manualInstructions:",
    "1. inspect Codex config shape before editing",
    `2. add an equivalent stop hook only if your Codex version supports it: ${stableBinary} ${codexHookCommandTemplate}`,
    "3. keep a backup of the original config before any manual change",
    "no files written"
  ].join("\n").concat("\n");
}

function localFileSummary(targetPath: string): string {
  return `${path.basename(targetPath)}#${createHash("sha256").update(path.resolve(targetPath)).digest("hex").slice(0, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
