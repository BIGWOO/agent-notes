import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { defaultConfigDir, defaultConfigPath, loadConfig } from "../core/config.js";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { resolvePath, type PathOptions } from "../core/paths.js";
import type { LocalConfig } from "../schemas/config.js";
import {
  executeWriteBatch,
  prepareWriteBatch,
  type FileWriteInput,
  type PreparedWriteBatch,
  type WriteBatchResult
} from "../core/writeSafety.js";

interface InitCommandOptions {
  readonly yes?: boolean;
  readonly lang?: string;
  readonly vaultPath?: string;
  readonly integrations?: boolean;
  readonly project?: boolean;
  readonly projectRepo?: string;
  readonly allowGitWorktreeVault?: boolean;
  readonly resume?: boolean;
  readonly rollback?: boolean;
  readonly dryRun?: boolean;
}

export interface InitContext extends PathOptions {
  readonly stdout?: (value: string) => void;
}

export interface InitResult {
  readonly batch: PreparedWriteBatch;
  readonly result: WriteBatchResult;
  readonly configPath: string;
  readonly projectMapPath: string;
  readonly status: "planned" | "already-initialized";
  readonly vaultPath: string;
}

const vaultGitignore = ["private/", ".agent-notes/", ".DS_Store", ""].join("\n");

const protocolTemplate = `# Agent Notes Protocol

This vault was created by Agent Notes.

Generated blocks are managed by the \`agent-notes\` CLI. Manual notes should live outside generated marker blocks.
`;

const summaryFileTemplate = `## Summary

## Changes

## Decisions

## Validation

## Next Steps

## Handoff
`;

const sessionCardTemplate = `---
type: agent-session
schemaVersion: 1
title: "{{title}}"
date: "{{date}}"
capturedAt: "{{capturedAt}}"
agent: "{{agent}}"
tool: "{{tool}}"
scope: "{{scope}}"
status: "{{status}}"
visibility: private
source:
  kind: "{{sourceKind}}"
  ref: "{{sourceRef}}"
  rawIncluded: false
sourceRefs:
  - "{{sourceRef}}"
derivedItems:
  decisions: []
  tasks: []
  contextUpdates: []
tags:
  - session
---

# {{title}}

## Summary

{{summary}}

## Changes

{{changes}}

## Decisions

{{decisions}}

## Validation

{{validation}}

## Next Steps

{{nextSteps}}

## Handoff

{{handoff}}

## Source

{{sourceSummary}}
`;

const projectReadmeTemplate = `# {{projectName}}

Manual notes live outside generated blocks.

<!-- agent-notes:start project-summary -->
<!-- agent-notes:end project-summary -->
`;

const activeTasksTemplate = `# Active Tasks

Manual notes live outside generated blocks.

<!-- agent-notes:start active-tasks -->
<!-- agent-notes:end active-tasks -->
`;

const decisionLogTemplate = `# Decision Log

Manual notes live outside generated blocks.

<!-- agent-notes:start decision-log -->
<!-- agent-notes:end decision-log -->
`;

const pitfallsTemplate = `# Pitfalls

Manual notes live outside generated blocks.

<!-- agent-notes:start pitfalls -->
<!-- agent-notes:end pitfalls -->
`;

export function registerInitCommand(program: Command): void {
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
    .action(async (options: InitCommandOptions) => {
      await runInitCommand(options);
    });
}

export async function runInitCommand(options: InitCommandOptions, context: InitContext = {}): Promise<InitResult> {
  const result = await runInit(options, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatInitResult(result, options.dryRun === true));

  return result;
}

export async function runInit(options: InitCommandOptions, context: InitContext = {}): Promise<InitResult> {
  validateStaticInitOptions(options);

  const locale = normalizeLocale(options.lang, context);

  if (locale === undefined) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "不支援的 locale，請使用 en 或 zh-TW");
  }

  const configDirectory = defaultConfigDir(context);
  const configPath = defaultConfigPath(context);
  const projectMapPath = path.join(configDirectory, "project-map.json");
  const operationId = "init";
  const existingConfig = readExistingLocalConfig(context);
  const vaultPath = resolvePath(options.vaultPath ?? existingConfig?.vaultPath ?? defaultVaultPath(context), context);

  if (existingConfig !== undefined && isSamePath(vaultPath, existingConfig.vaultPath) && isValidAgentNotesVault(vaultPath)) {
    const batch = prepareWriteBatch({
      command: "init",
      operationId,
      writes: []
    });

    return {
      batch,
      result: {
        operationId,
        written: [],
        skipped: [],
        warnings: []
      },
      configPath,
      projectMapPath,
      status: "already-initialized",
      vaultPath
    };
  }

  validateWritableInitOptions(options);

  validateTargetVault(vaultPath);

  if (options.allowGitWorktreeVault !== true && isInsideGitWorktree(vaultPath)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "vault path 位於 Git worktree 內");
  }

  const batch = prepareWriteBatch({
    command: "init",
    operationId,
    writes: buildInitWrites({
      configPath,
      locale,
      projectMapPath,
      vaultPath
    })
  });

  const writeResult = await executeWriteBatch({
    batch,
    lockFilePath: path.join(configDirectory, "init-state.json"),
    backupRootPath: path.join(configDirectory, "backups", operationId),
    dryRun: options.dryRun === true
  });

  return {
    batch,
    result: writeResult,
    configPath,
    projectMapPath,
    status: "planned",
    vaultPath
  };
}

function validateStaticInitOptions(options: InitCommandOptions): void {
  if (options.resume === true || options.rollback === true || options.projectRepo !== undefined) {
    throw new AgentNotesError(ErrorCode.FEATURE_UNSUPPORTED, "init resume、rollback 與 first project onboarding 尚未實作");
  }

  if (options.lang !== undefined && normalizeLocale(options.lang) === undefined) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "不支援的 locale，請使用 en 或 zh-TW");
  }
}

function validateWritableInitOptions(options: InitCommandOptions): void {
  if (options.dryRun === true) {
    return;
  }

  if (
    options.yes !== true ||
    options.lang === undefined ||
    options.vaultPath === undefined ||
    options.integrations !== false ||
    options.project !== false
  ) {
    throw new AgentNotesError(
      ErrorCode.NON_INTERACTIVE_REQUIRED,
      "非互動 init 需要 --yes、--lang、--vault-path、--no-integrations、--no-project"
    );
  }
}

function readExistingLocalConfig(context: InitContext): LocalConfig | undefined {
  try {
    return loadConfig(context);
  } catch (error) {
    if (error instanceof AgentNotesError && error.code === ErrorCode.CONFIG_NOT_FOUND) {
      return undefined;
    }

    throw error;
  }
}

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function normalizeLocale(locale?: string, context: PathOptions = {}): "en" | "zh-TW" | undefined {
  const detectedLocale = locale ?? context.env?.LC_ALL ?? context.env?.LC_MESSAGES ?? context.env?.LANG ?? "en";
  const normalized = detectedLocale.replaceAll("_", "-").toLowerCase();

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }

  if (normalized === "zh-tw" || normalized.startsWith("zh-tw.") || normalized === "zh-hant-tw") {
    return "zh-TW";
  }

  return locale === undefined ? "en" : undefined;
}

function defaultVaultPath(context: PathOptions): string {
  return path.join(context.homeDir ?? context.env?.HOME ?? process.env.HOME ?? process.cwd(), "Documents", "Agent-Notes");
}

function validateTargetVault(vaultPath: string): void {
  if (!existsSync(vaultPath)) {
    return;
  }

  const targetStat = statSync(vaultPath);

  if (!targetStat.isDirectory()) {
    throw new AgentNotesError(ErrorCode.PATH_INVALID, "vault path 已存在且不是目錄");
  }

  if (isValidAgentNotesVault(vaultPath)) {
    throw new AgentNotesError(ErrorCode.VAULT_ALREADY_INITIALIZED, "目標 path 已是 Agent Notes vault");
  }

  if (readdirSync(vaultPath).length > 0) {
    throw new AgentNotesError(ErrorCode.VAULT_EXISTS_NON_EMPTY, "目標 path 非空且不是 Agent Notes vault");
  }
}

function isValidAgentNotesVault(vaultPath: string): boolean {
  return (
    existsSync(path.join(vaultPath, ".gitignore")) &&
    existsSync(path.join(vaultPath, "00-Meta", "Systems", "agent-note-protocol.md")) &&
    existsSync(path.join(vaultPath, "06-Templates"))
  );
}

function isInsideGitWorktree(targetPath: string): boolean {
  const existingParent = nearestExistingParent(targetPath);

  try {
    const gitRoot = realpathSync.native(
      execFileSync("git", ["-C", existingParent, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim()
    );
    const canonicalParent = realpathSync.native(existingParent);
    const canonicalTarget = path.join(canonicalParent, path.relative(existingParent, targetPath));
    const relative = path.relative(gitRoot, canonicalTarget);

    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function nearestExistingParent(targetPath: string): string {
  let currentPath = path.resolve(targetPath);

  while (!existsSync(currentPath)) {
    const parent = path.dirname(currentPath);

    if (parent === currentPath) {
      return parent;
    }

    currentPath = parent;
  }

  return currentPath;
}

function buildInitWrites(input: {
  readonly configPath: string;
  readonly locale: "en" | "zh-TW";
  readonly projectMapPath: string;
  readonly vaultPath: string;
}): FileWriteInput[] {
  const localConfig = {
    version: 1,
    locale: input.locale,
    vaultPath: input.vaultPath,
    projectMapPath: input.projectMapPath,
    privacy: {
      defaultVisibility: "private",
      recordAbsolutePathsInNotes: false,
      copyRawTranscripts: false
    },
    sharing: {
      mode: "personal",
      access: "read-write",
      agentWritePolicy: "local-only"
    },
    integrations: {
      codex: {
        enabled: false
      }
    }
  };
  const projectMap = {
    version: 1,
    vaultPath: input.vaultPath,
    projects: []
  };
  const write = (relativePath: string, content: string): FileWriteInput => ({
    targetPath: path.join(input.vaultPath, relativePath),
    content,
    backupKey: relativePath
  });

  return [
    write(".gitignore", vaultGitignore),
    write("00-Meta/Systems/agent-note-protocol.md", protocolTemplate),
    write("06-Templates/summary-file.md", summaryFileTemplate),
    write("06-Templates/session-card.md", sessionCardTemplate),
    write("06-Templates/project-README.md", projectReadmeTemplate),
    write("06-Templates/active-tasks.md", activeTasksTemplate),
    write("06-Templates/decision-log.md", decisionLogTemplate),
    write("06-Templates/pitfalls.md", pitfallsTemplate),
    write("01-Inbox/shared-capture/.gitkeep", ""),
    write("02-Daily/.gitkeep", ""),
    write("03-Projects/.gitkeep", ""),
    write("04-Areas/.gitkeep", ""),
    write("05-Resources/.gitkeep", ""),
    write("07-Archives/.gitkeep", ""),
    write("private/raw-sessions/.gitkeep", ""),
    {
      targetPath: input.configPath,
      content: `${JSON.stringify(localConfig, null, 2)}\n`,
      backupKey: "config.json"
    },
    {
      targetPath: input.projectMapPath,
      content: `${JSON.stringify(projectMap, null, 2)}\n`,
      backupKey: "project-map.json"
    }
  ];
}

function formatInitResult(result: InitResult, dryRun: boolean): string {
  const lines = [
    result.status === "already-initialized"
      ? "Agent Notes already initialized"
      : dryRun
        ? "Agent Notes init dry-run"
        : "Agent Notes init complete",
    `operationId: ${result.batch.plan.operationId}`,
    `vaultPath: ${formatOutputPath(result.vaultPath, dryRun, "vault path")}`,
    `configPath: ${formatOutputPath(result.configPath, dryRun, "local config path")}`,
    `projectMapPath: ${formatOutputPath(result.projectMapPath, dryRun, "project map path")}`,
    `filesToCreate: ${result.batch.plan.filesToCreate.length}`,
    `filesToModify: ${result.batch.plan.filesToModify.length}`,
    `filesToSkip: ${result.batch.plan.filesToSkip.length}`
  ];

  if (dryRun) {
    lines.push("no files written");
  } else if (result.status === "already-initialized") {
    lines.push("written: 0");
    lines.push("next: agent-notes doctor");
  } else {
    lines.push(`written: ${result.result.written.length}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatOutputPath(targetPath: string, dryRun: boolean, label: string): string {
  if (!dryRun) {
    return targetPath;
  }

  return `${path.basename(targetPath)} (redacted ${label})`;
}
