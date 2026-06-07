import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import {
  detectConfigCandidates,
  localFileSummary,
  stableBinaryFor,
  type IntegrationContext,
  type IntegrationDryRunResult,
  type IntegrationStatus
} from "../core/integrationAdapters.js";
import { resolvePath } from "../core/paths.js";
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

type IntegrateAgentOptions = IntegrateCodexOptions;

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

export type IntegrateClaudeCodeResult = IntegrationDryRunResult;
export type IntegrateOpenClawResult = IntegrationDryRunResult;

interface RecognizedCodexConfig {
  readonly config: Record<string, unknown>;
  readonly configPath: string;
}

const codexConfigFileName = "config.json";
const codexHookCommandTemplate = 'capture --tool codex --scope inbox --summary-file "$AGENT_NOTES_SUMMARY_FILE"';
const claudeCodeHookCommandTemplate = 'capture --tool claude-code --scope inbox --summary-file "$AGENT_NOTES_SUMMARY_FILE"';
const openClawHookCommandTemplate = 'capture --tool openclaw --scope inbox --summary-file "$AGENT_NOTES_SUMMARY_FILE"';

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

  integrate
    .command("claude-code")
    .description("預覽 Claude Code hook integration")
    .option("--dry-run", "顯示 hook template 與偵測摘要，不寫入檔案")
    .option("--apply", "套用 Claude Code integration（Phase 2 尚未支援）")
    .option("--binary <path>", "指定穩定 agent-notes binary path")
    .option("--yes", "保留給未來 apply 流程")
    .action(async (options: IntegrateAgentOptions) => {
      await runIntegrateClaudeCodeCommand(options);
    });

  integrate
    .command("openclaw")
    .description("預覽 OpenClaw workflow integration")
    .option("--dry-run", "顯示 workflow template 與偵測摘要，不寫入檔案")
    .option("--apply", "套用 OpenClaw integration（Phase 2 尚未支援）")
    .option("--binary <path>", "指定穩定 agent-notes binary path")
    .option("--yes", "保留給未來 apply 流程")
    .action(async (options: IntegrateAgentOptions) => {
      await runIntegrateOpenClawCommand(options);
    });
}

export function runIntegrateListCommand(context: IntegrationContext = {}): IntegrateListResult {
  const result = runIntegrateList(context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatIntegrateListResult(result));

  return result;
}

export function runIntegrateList(context: IntegrationContext = {}): IntegrateListResult {
  return {
    integrations: [
      codexStatus(context),
      claudeCodeStatus(),
      openClawStatus()
    ]
  };
}

export async function runIntegrateCodexCommand(
  options: IntegrateCodexOptions,
  context: IntegrationContext = {}
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
  context: IntegrationContext = {}
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
          backupRootPath,
          ...(context.beforeApply === undefined ? {} : { beforeApply: context.beforeApply }),
          ...(context.afterApply === undefined ? {} : { afterApply: context.afterApply })
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

export async function runIntegrateClaudeCodeCommand(
  options: IntegrateAgentOptions,
  context: IntegrationContext = {}
): Promise<IntegrateClaudeCodeResult> {
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));
  const result = await runIntegrateClaudeCode(options, context);

  output(formatIntegrationDryRunResult(result));

  return result;
}

export async function runIntegrateClaudeCode(
  options: IntegrateAgentOptions,
  context: IntegrationContext = {}
): Promise<IntegrateClaudeCodeResult> {
  if (options.dryRun === true && options.apply === true) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "integrate claude-code 不能同時使用 --dry-run 與 --apply");
  }

  if (options.apply === true) {
    throw new AgentNotesError(ErrorCode.INTEGRATION_UNSUPPORTED, "Claude Code apply 尚未支援；Phase 2 先提供 dry-run skeleton");
  }

  const stableBinary = stableBinaryFor(options.binary, "dry-run");
  const hookCommand = `${stableBinary} ${claudeCodeHookCommandTemplate}`;
  const detection = detectConfigCandidates({
    context,
    envRootName: "CLAUDE_HOME",
    fallbackRoot: "~/.claude",
    fileNames: ["settings.json", "settings.local.json"]
  });

  return {
    agent: "claude-code",
    mode: "dry-run",
    checkedConfigCandidates: detection.checkedConfigCandidates,
    detectionSummary: detection.detectedSummary,
    hookCommand,
    stableBinary,
    filesToModify: 0,
    filesToBackup: 0,
    hints: [
      "Claude Code hook schema 尚未 fixture-driven 驗證，Phase 2 只提供 dry-run preview",
      "apply 需等 config shape、backup、rollback tests 與 code review 完成後才開放",
      `config root source: ${detection.rootSource}`,
      "若本機設定路徑不同，請先用文件或 fixture 補上偵測規則"
    ]
  };
}

export async function runIntegrateOpenClawCommand(
  options: IntegrateAgentOptions,
  context: IntegrationContext = {}
): Promise<IntegrateOpenClawResult> {
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));
  const result = await runIntegrateOpenClaw(options, context);

  output(formatIntegrationDryRunResult(result));

  return result;
}

export async function runIntegrateOpenClaw(
  options: IntegrateAgentOptions,
  context: IntegrationContext = {}
): Promise<IntegrateOpenClawResult> {
  if (options.dryRun === true && options.apply === true) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "integrate openclaw 不能同時使用 --dry-run 與 --apply");
  }

  if (options.apply === true) {
    throw new AgentNotesError(ErrorCode.INTEGRATION_UNSUPPORTED, "OpenClaw apply 尚未支援；Phase 2 先提供 dry-run skeleton");
  }

  const stableBinary = stableBinaryFor(options.binary, "dry-run");
  const hookCommand = `${stableBinary} ${openClawHookCommandTemplate}`;
  const detection = detectConfigCandidates({
    context,
    envRootName: "OPENCLAW_HOME",
    fallbackRoot: "~/.openclaw",
    fileNames: ["config.json", "openclaw.json", "workflows.json"]
  });

  return {
    agent: "openclaw",
    mode: "dry-run",
    checkedConfigCandidates: detection.checkedConfigCandidates,
    detectionSummary: detection.detectedSummary,
    hookCommand,
    stableBinary,
    filesToModify: 0,
    filesToBackup: 0,
    hints: [
      "OpenClaw workflow schema 尚未 fixture-driven 驗證，Phase 2 只提供 dry-run preview",
      "apply 需等 workflow/config shape、backup、rollback tests 與 code review 完成後才開放",
      `config root source: ${detection.rootSource}`,
      "若本機 workflow 路徑不同，請先用公開 fixture 補上偵測規則"
    ]
  };
}

function codexStatus(context: IntegrationContext): IntegrationStatus {
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

function claudeCodeStatus(): IntegrationStatus {
  return {
    agent: "claude-code",
    status: "dry-run-only",
    message: "dry-run skeleton available; apply unsupported"
  };
}

function openClawStatus(): IntegrationStatus {
  return {
    agent: "openclaw",
    status: "dry-run-only",
    message: "dry-run skeleton available; apply unsupported"
  };
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

function codexHome(context: IntegrationContext): string {
  return resolvePath(context.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? "~/.codex", context);
}

function formatIntegrateListResult(result: IntegrateListResult): string {
  return `${result.integrations.map((integration) => `${integration.agent}: ${integration.status} (${integration.message})`).join("\n")}\n`;
}

function formatIntegrateCodexResult(result: IntegrateCodexResult): string {
  const lines = [
    `codex: ${result.mode}`,
    `config: ${result.configSummary}`,
    `binary: ${safeBinarySummary(result.stableBinary)}`,
    `hookCommand: ${safeHookCommandPreview(result.hookCommand, result.stableBinary)}`,
    `filesToModify: ${result.batch.plan.filesToModify.length}`,
    `filesToBackup: ${result.batch.plan.rollbackPlan.modified.length}`,
    `backupRoot: ${result.backupRootSummary}`,
    result.mode === "dry-run" ? "no files written" : `written: ${result.result.written.length}`,
    result.mode === "dry-run" ? "recovery: no changes were applied" : "next: agent-notes doctor"
  ];

  return `${lines.join("\n")}\n`;
}

function formatIntegrationDryRunResult(result: IntegrationDryRunResult): string {
  const lines = [
    `${result.agent}: ${result.mode}`,
    `detectedConfig: ${result.detectionSummary}`,
    `checkedConfigCandidates: ${result.checkedConfigCandidates.join(",")}`,
    `binary: ${safeBinarySummary(result.stableBinary)}`,
    `hookCommand: ${safeHookCommandPreview(result.hookCommand, result.stableBinary)}`,
    `filesToModify: ${result.filesToModify}`,
    `filesToBackup: ${result.filesToBackup}`,
    "no files written",
    ...result.hints.map((hint) => `hint: ${hint}`)
  ];

  return `${lines.join("\n")}\n`;
}

function formatCodexManualInstructions(stableBinary: string): string {
  return [
    "codex: unsupported",
    "manualInstructions:",
    "1. inspect Codex config shape before editing",
    `2. add an equivalent stop hook only if your Codex version supports it: ${safeBinarySummary(stableBinary)} ${codexHookCommandTemplate}`,
    "3. keep a backup of the original config before any manual change",
    "no files written"
  ].join("\n").concat("\n");
}

function safeBinarySummary(binary: string): string {
  return path.isAbsolute(binary) ? localFileSummary(binary) : binary;
}

function safeHookCommandPreview(hookCommand: string, stableBinary: string): string {
  const binarySummary = safeBinarySummary(stableBinary);

  return hookCommand === stableBinary || !hookCommand.startsWith(`${stableBinary} `)
    ? hookCommand.replace(stableBinary, binarySummary)
    : `${binarySummary}${hookCommand.slice(stableBinary.length)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
