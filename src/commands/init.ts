import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { defaultConfigDir, defaultConfigPath, loadConfig } from "../core/config.js";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { resolvePath, type PathOptions } from "../core/paths.js";
import type { LocalConfig } from "../schemas/config.js";
import {
  executeWriteBatch,
  hashContent,
  prepareWriteBatch,
  withWriteLock,
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

interface InitConfirmPrompt {
  readonly message: string;
  readonly defaultValue: boolean;
}

export interface InitContext extends PathOptions {
  readonly stdout?: (value: string) => void;
  readonly confirm?: (prompt: InitConfirmPrompt) => Promise<boolean> | boolean;
}

export interface InitResult {
  readonly batch: PreparedWriteBatch;
  readonly result: WriteBatchResult;
  readonly configPath: string;
  readonly projectMapPath: string;
  readonly status: "planned" | "already-initialized" | "resumed" | "rolled-back";
  readonly vaultPath: string;
  readonly rollbackSummary?: InitRollbackSummary;
}

interface InitStateFile {
  readonly version: 1;
  readonly operationId: string;
  readonly command: "init";
  readonly status: "in-progress";
  readonly targetVaultPathKey: string;
  readonly locale: "en" | "zh-TW";
  readonly vaultPath: string;
  readonly configPath: string;
  readonly projectMapPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly files: readonly {
    readonly targetPath: string;
    readonly contentHash: string;
  }[];
}

interface InitStateStore {
  readonly states: ReadonlyMap<string, InitStateFile>;
}

interface InitRollbackSummary {
  readonly filesToDelete: readonly string[];
  readonly filesAlreadyMissing: readonly string[];
  readonly modifiedConflicts: readonly string[];
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
  const result = await runInit(options, withDefaultInitConfirm(context));
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatInitResult(result, options.dryRun === true));

  return result;
}

function withDefaultInitConfirm(context: InitContext): InitContext {
  if (context.confirm !== undefined || process.stdin.isTTY !== true) {
    return context;
  }

  return {
    ...context,
    confirm: defaultInitConfirm
  };
}

async function defaultInitConfirm(prompt: InitConfirmPrompt): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const suffix = prompt.defaultValue ? "[Y/n]" : "[y/N]";
    const answer = (await readline.question(`${prompt.message}\nContinue? ${suffix} `)).trim().toLowerCase();

    if (answer === "") {
      return prompt.defaultValue;
    }

    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
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
  const initStatePath = path.join(configDirectory, "init-state.json");
  const initStateStore = readInitStateStore(initStatePath);
  const requestedVaultPath = options.vaultPath === undefined ? undefined : resolvePath(options.vaultPath, context);
  const requestedInitState =
    requestedVaultPath === undefined
      ? findSingleInitState(initStateStore)
      : findInitStateByVaultPath(initStateStore, requestedVaultPath);

  if (requestedInitState !== undefined) {
    return handlePartialInitState(requestedInitState, initStatePath, configDirectory, options);
  }

  const existingConfig = readExistingLocalConfig(context);
  const vaultPath = requestedVaultPath ?? resolvePath(existingConfig?.vaultPath ?? defaultVaultPath(context), context);
  const matchingInitState = findInitStateByVaultPath(initStateStore, vaultPath);

  if (matchingInitState !== undefined) {
    return handlePartialInitState(matchingInitState, initStatePath, configDirectory, options);
  }

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

  if (options.resume === true || options.rollback === true) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "找不到符合 vault path 的 init-state.json");
  }

  validateWritableInitOptions(options, context);

  validateTargetVault(vaultPath);

  if (options.allowGitWorktreeVault !== true && isInsideGitWorktree(vaultPath)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "vault path 位於 Git worktree 內");
  }

  const writes = buildInitWrites({
    configPath,
    locale,
    projectMapPath,
    vaultPath
  });
  const batch = prepareWriteBatch({
    command: "init",
    operationId,
    writes
  });
  const initState = createInitState({
    configPath,
    locale,
    operationId,
    projectMapPath,
    vaultPath,
    writes
  });

  await confirmInitWritePlan(options, context, {
    configPath,
    projectMapPath,
    vaultPath,
    batch
  });

  const writeResult = await executeWriteBatch({
    batch,
    lockFilePath: path.join(configDirectory, "init.lock"),
    backupRootPath: path.join(configDirectory, "backups", operationId),
    dryRun: options.dryRun === true,
    beforeApply: () => writeInitState(initStatePath, initState),
    afterApply: () => removeCurrentInitState(initStatePath, initState),
    onFailure: ({ written }) => {
      if (written.length === 0) {
        removeInitStateIfCurrent(initStatePath, initState);
      }
    }
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
  if (options.resume === true && options.rollback === true) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "init 不能同時使用 --resume 與 --rollback");
  }

  if (options.projectRepo !== undefined) {
    throw new AgentNotesError(ErrorCode.FEATURE_UNSUPPORTED, "first project onboarding 尚未實作");
  }

  if (options.lang !== undefined && normalizeLocale(options.lang) === undefined) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "不支援的 locale，請使用 en 或 zh-TW");
  }
}

function validateWritableInitOptions(options: InitCommandOptions, context: InitContext): void {
  if (options.dryRun === true) {
    return;
  }

  if (
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

  if (options.yes !== true && context.confirm === undefined) {
    throw new AgentNotesError(
      ErrorCode.NON_INTERACTIVE_REQUIRED,
      "非互動 init 需要 --yes；互動模式需可顯示確認提示"
    );
  }
}

async function confirmInitWritePlan(
  options: InitCommandOptions,
  context: InitContext,
  input: {
    readonly batch: PreparedWriteBatch;
    readonly configPath: string;
    readonly projectMapPath: string;
    readonly vaultPath: string;
  }
): Promise<void> {
  if (options.dryRun === true || options.yes === true) {
    return;
  }

  const confirmed = await context.confirm?.({
    message: [
      "Agent Notes init will create:",
      `- vault: ${input.vaultPath}`,
      `- local config: ${input.configPath}`,
      `- project map: ${input.projectMapPath}`,
      `- files to create: ${input.batch.plan.filesToCreate.length}`,
      `- files to modify: ${input.batch.plan.filesToModify.length}`
    ].join("\n"),
    defaultValue: false
  });

  if (confirmed !== true) {
    throw new AgentNotesError(ErrorCode.INIT_CANCELLED, "使用者取消 init");
  }
}

async function handlePartialInitState(
  state: InitStateFile,
  initStatePath: string,
  configDirectory: string,
  options: InitCommandOptions
): Promise<InitResult> {
  if (options.resume === true) {
    return resumeInit(state, initStatePath, configDirectory, options);
  }

  if (options.rollback === true) {
    return rollbackInit(state, initStatePath, configDirectory, options);
  }

  throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "偵測到未完成的 init，請使用 --resume 或 --rollback");
}

async function resumeInit(
  state: InitStateFile,
  initStatePath: string,
  configDirectory: string,
  options: InitCommandOptions
): Promise<InitResult> {
  const writes = buildInitWritesFromState(state);

  assertResumeTargetsSafe(writes, state);

  const batch = prepareWriteBatch({
    command: "init",
    operationId: state.operationId,
    writes
  });
  const writeResult = await executeWriteBatch({
    batch,
    lockFilePath: path.join(configDirectory, "init.lock"),
    backupRootPath: path.join(configDirectory, "backups", state.operationId),
    dryRun: options.dryRun === true,
    beforeApply: () => assertCurrentInitState(initStatePath, state),
    afterApply: () => removeCurrentInitState(initStatePath, state)
  });

  return {
    batch,
    result: writeResult,
    configPath: state.configPath,
    projectMapPath: state.projectMapPath,
    status: "resumed",
    vaultPath: state.vaultPath
  };
}

async function rollbackInit(
  state: InitStateFile,
  initStatePath: string,
  configDirectory: string,
  options: InitCommandOptions
): Promise<InitResult> {
  const writes = buildInitWritesFromState(state);
  const batch = prepareWriteBatch({
    command: "init",
    operationId: state.operationId,
    writes
  });
  const rollbackSummary = prepareInitRollbackSummary(writes);

  if (options.dryRun !== true) {
    await withWriteLock({
      command: "init",
      lockFilePath: path.join(configDirectory, "init.lock"),
      operationId: state.operationId,
      action: () => {
        assertCurrentInitState(initStatePath, state);

        const lockedRollbackSummary = prepareInitRollbackSummary(writes);

        if (lockedRollbackSummary.modifiedConflicts.length > 0) {
          throw new AgentNotesError(
            ErrorCode.WRITE_CONFLICT,
            `rollback incomplete: ${lockedRollbackSummary.modifiedConflicts.join("; ")}`
          );
        }

        rollbackInitFiles(lockedRollbackSummary.filesToDelete);
        removeCurrentInitState(initStatePath, state);
        removeEmptyInitDirectories(writes, state.vaultPath);
      }
    });
  }

  return {
    batch,
    result: {
      operationId: state.operationId,
      written: [],
      skipped: batch.plan.filesToSkip,
      warnings: []
    },
    configPath: state.configPath,
    projectMapPath: state.projectMapPath,
    status: "rolled-back",
    vaultPath: state.vaultPath,
    rollbackSummary
  };
}

function createInitState(input: {
  readonly configPath: string;
  readonly locale: "en" | "zh-TW";
  readonly operationId: string;
  readonly projectMapPath: string;
  readonly vaultPath: string;
  readonly writes: readonly FileWriteInput[];
}): InitStateFile {
  const now = new Date().toISOString();

  return {
    version: 1,
    operationId: input.operationId,
    command: "init",
    status: "in-progress",
    targetVaultPathKey: canonicalVaultPathKey(input.vaultPath),
    locale: input.locale,
    vaultPath: input.vaultPath,
    configPath: input.configPath,
    projectMapPath: input.projectMapPath,
    createdAt: now,
    updatedAt: now,
    files: input.writes.map((write) => ({
      targetPath: path.resolve(write.targetPath),
      contentHash: hashContent(write.content)
    }))
  };
}

function readInitStateStore(initStatePath: string): InitStateStore | undefined {
  if (!existsSync(initStatePath)) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(initStatePath, "utf8"));
  } catch {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json 不是有效 JSON");
  }

  return parseInitStateStore(parsed, initStatePath);
}

function parseInitStateStore(value: unknown, initStatePath: string): InitStateStore {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json 格式無效");
  }

  const store = value as Record<string, unknown>;

  if (store.version !== 1 || store.command !== "init" || !isRecord(store.states)) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json 格式無效");
  }

  const states = new Map<string, InitStateFile>();

  for (const [targetVaultPathKey, stateValue] of Object.entries(store.states)) {
    const state = parseInitState(stateValue, initStatePath);

    if (targetVaultPathKey !== state.targetVaultPathKey) {
      throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json key 與 vault path 不一致");
    }

    states.set(targetVaultPathKey, state);
  }

  return {
    states
  };
}

function parseInitState(value: unknown, initStatePath: string): InitStateFile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json 格式無效");
  }

  const state = value as Record<string, unknown>;

  if (
    state.version !== 1 ||
    state.operationId !== "init" ||
    state.command !== "init" ||
    state.status !== "in-progress" ||
    typeof state.targetVaultPathKey !== "string" ||
    (state.locale !== "en" && state.locale !== "zh-TW") ||
    typeof state.vaultPath !== "string" ||
    typeof state.configPath !== "string" ||
    typeof state.projectMapPath !== "string" ||
    typeof state.createdAt !== "string" ||
    typeof state.updatedAt !== "string" ||
    !Array.isArray(state.files)
  ) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json 格式無效");
  }

  const configDirectory = path.dirname(initStatePath);
  const vaultPath = normalizeStoredAbsolutePath(state.vaultPath, "vaultPath");
  const configPath = normalizeStoredAbsolutePath(state.configPath, "configPath");
  const projectMapPath = normalizeStoredAbsolutePath(state.projectMapPath, "projectMapPath");
  const targetVaultPathKey = canonicalVaultPathKey(vaultPath);

  if (
    state.targetVaultPathKey !== targetVaultPathKey ||
    configPath !== path.resolve(configDirectory, "config.json") ||
    projectMapPath !== path.resolve(configDirectory, "project-map.json")
  ) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json path 格式無效");
  }

  const files = state.files.map((file) => parseInitStateFileEntry(file, { configPath, projectMapPath, vaultPath }));

  return {
    version: 1,
    operationId: "init",
    command: "init",
    status: "in-progress",
    targetVaultPathKey,
    locale: state.locale,
    vaultPath,
    configPath,
    projectMapPath,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    files
  };
}

function parseInitStateFileEntry(
  value: unknown,
  allowedPaths: {
    readonly configPath: string;
    readonly projectMapPath: string;
    readonly vaultPath: string;
  }
): InitStateFile["files"][number] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json files 格式無效");
  }

  const entry = value as Record<string, unknown>;

  if (typeof entry.targetPath !== "string" || typeof entry.contentHash !== "string") {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json files 格式無效");
  }

  const targetPath = normalizeStoredAbsolutePath(entry.targetPath, "targetPath");

  if (
    !isSamePath(targetPath, allowedPaths.configPath) &&
    !isSamePath(targetPath, allowedPaths.projectMapPath) &&
    !isPathInside(allowedPaths.vaultPath, targetPath)
  ) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json target path 超出允許範圍");
  }

  if (!/^sha256:[a-f0-9]{64}$/u.test(entry.contentHash)) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json contentHash 格式無效");
  }

  return {
    targetPath,
    contentHash: entry.contentHash
  };
}

function writeInitState(initStatePath: string, state: InitStateFile): void {
  const store = readInitStateStore(initStatePath) ?? { states: new Map<string, InitStateFile>() };
  const existingState = store.states.get(state.targetVaultPathKey);

  if (existingState !== undefined && !isSameInitState(existingState, state)) {
    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, "init-state.json 已存在其他 init 操作");
  }

  const nextStates = new Map(store.states);

  nextStates.set(state.targetVaultPathKey, state);
  writeInitStateStore(initStatePath, {
    states: nextStates
  });
}

function assertCurrentInitState(initStatePath: string, expectedState: InitStateFile): void {
  const currentState = readInitStateStore(initStatePath)?.states.get(expectedState.targetVaultPathKey);

  if (currentState === undefined || !isSameInitState(currentState, expectedState)) {
    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, "init-state.json 已被其他 init 操作更新");
  }
}

function removeCurrentInitState(initStatePath: string, expectedState: InitStateFile): void {
  if (!removeInitStateIfCurrent(initStatePath, expectedState)) {
    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, "init-state.json 已被其他 init 操作更新");
  }
}

function removeInitStateIfCurrent(initStatePath: string, expectedState: InitStateFile): boolean {
  const store = readInitStateStore(initStatePath);
  const currentState = store?.states.get(expectedState.targetVaultPathKey);

  if (store === undefined || currentState === undefined || !isSameInitState(currentState, expectedState)) {
    return false;
  }

  const nextStates = new Map(store.states);

  nextStates.delete(expectedState.targetVaultPathKey);

  if (nextStates.size === 0) {
    rmSync(initStatePath, {
      force: true
    });

    return true;
  }

  writeInitStateStore(initStatePath, {
    states: nextStates
  });

  return true;
}

function writeInitStateStore(initStatePath: string, store: InitStateStore): void {
  mkdirSync(path.dirname(initStatePath), {
    recursive: true
  });

  const tempPath = path.join(path.dirname(initStatePath), `.init-state.${process.pid}.tmp`);

  writeFileSync(tempPath, `${JSON.stringify(serializeInitStateStore(store), null, 2)}\n`);
  renameSync(tempPath, initStatePath);
}

function serializeInitStateStore(store: InitStateStore): Record<string, unknown> {
  return {
    version: 1,
    command: "init",
    states: Object.fromEntries([...store.states.entries()].sort(([left], [right]) => left.localeCompare(right)))
  };
}

function isSameInitState(left: InitStateFile, right: InitStateFile): boolean {
  return initStateIdentity(left) === initStateIdentity(right);
}

function initStateIdentity(state: InitStateFile): string {
  return JSON.stringify({
    version: state.version,
    operationId: state.operationId,
    command: state.command,
    status: state.status,
    targetVaultPathKey: state.targetVaultPathKey,
    locale: state.locale,
    vaultPath: path.resolve(state.vaultPath),
    configPath: path.resolve(state.configPath),
    projectMapPath: path.resolve(state.projectMapPath),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    files: state.files.map((file) => ({
      targetPath: path.resolve(file.targetPath),
      contentHash: file.contentHash
    }))
  });
}

function findSingleInitState(store: InitStateStore | undefined): InitStateFile | undefined {
  if (store === undefined || store.states.size !== 1) {
    return undefined;
  }

  return [...store.states.values()][0];
}

function findInitStateByVaultPath(store: InitStateStore | undefined, vaultPath: string): InitStateFile | undefined {
  return store?.states.get(canonicalVaultPathKey(vaultPath));
}

function canonicalVaultPathKey(vaultPath: string): string {
  const resolvedVaultPath = path.resolve(vaultPath);
  const existingParent = nearestExistingParent(resolvedVaultPath);
  const canonicalParent = realpathSync.native(existingParent);

  return path.join(canonicalParent, path.relative(existingParent, resolvedVaultPath));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStoredAbsolutePath(value: string, fieldName: string): string {
  if (value.trim() === "" || value.includes("\0") || !path.isAbsolute(value)) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, `init-state.json ${fieldName} 必須是 absolute path`);
  }

  return path.resolve(value);
}

function buildInitWritesFromState(state: InitStateFile): FileWriteInput[] {
  const writes = buildInitWrites({
    configPath: state.configPath,
    locale: state.locale,
    projectMapPath: state.projectMapPath,
    vaultPath: state.vaultPath
  });
  const expected = new Map(state.files.map((file) => [path.resolve(file.targetPath), file.contentHash]));

  if (expected.size !== writes.length) {
    throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json 與目前 init plan 不一致");
  }

  for (const write of writes) {
    const targetPath = path.resolve(write.targetPath);

    if (expected.get(targetPath) !== hashContent(write.content)) {
      throw new AgentNotesError(ErrorCode.INIT_PARTIAL, "init-state.json 與目前 init plan 不一致");
    }
  }

  return writes;
}

function assertResumeTargetsSafe(writes: readonly FileWriteInput[], state: InitStateFile): void {
  for (const write of writes) {
    if (!existsSync(write.targetPath)) {
      continue;
    }

    const currentHash = hashContent(readFileSync(write.targetPath, "utf8"));
    const plannedHash = hashContent(write.content);

    if (currentHash !== plannedHash) {
      throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `partial init target 已被修改: ${formatInitTarget(write.targetPath, state)}`);
    }
  }
}

function prepareInitRollbackSummary(writes: readonly FileWriteInput[]): InitRollbackSummary {
  const filesToDelete: string[] = [];
  const filesAlreadyMissing: string[] = [];
  const modifiedConflicts: string[] = [];

  for (const write of writes) {
    if (!existsSync(write.targetPath)) {
      filesAlreadyMissing.push(write.targetPath);
      continue;
    }

    const currentHash = hashContent(readFileSync(write.targetPath, "utf8"));
    const plannedHash = hashContent(write.content);

    if (currentHash !== plannedHash) {
      modifiedConflicts.push(`${path.basename(write.targetPath)} 已被修改`);
      continue;
    }

    filesToDelete.push(write.targetPath);
  }

  return {
    filesToDelete,
    filesAlreadyMissing,
    modifiedConflicts
  };
}

function rollbackInitFiles(filesToDelete: readonly string[]): void {
  for (const targetPath of [...filesToDelete].reverse()) {
    rmSync(targetPath, {
      force: true
    });
  }
}

function removeEmptyInitDirectories(writes: readonly FileWriteInput[], vaultPath: string): void {
  const directories = new Set(writes.map((write) => path.dirname(write.targetPath)));

  directories.add(vaultPath);

  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      rmSync(directory);
    } catch {
      // 目錄不存在、非空或不可移除時保留，比強制清理安全。
    }
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

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));

  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function formatInitTarget(targetPath: string, state: InitStateFile): string {
  const resolvedTargetPath = path.resolve(targetPath);

  if (isSamePath(resolvedTargetPath, state.configPath)) {
    return "config.json";
  }

  if (isSamePath(resolvedTargetPath, state.projectMapPath)) {
    return "project-map.json";
  }

  if (isPathInside(state.vaultPath, resolvedTargetPath)) {
    return path.relative(state.vaultPath, resolvedTargetPath).split(path.sep).join("/");
  }

  return path.basename(resolvedTargetPath);
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
    headlineFor(result.status, dryRun),
    `operationId: ${result.batch.plan.operationId}`,
    `vaultPath: ${formatOutputPath(result.vaultPath, dryRun, "vault path")}`,
    `configPath: ${formatOutputPath(result.configPath, dryRun, "local config path")}`,
    `projectMapPath: ${formatOutputPath(result.projectMapPath, dryRun, "project map path")}`
  ];

  if (result.status === "rolled-back") {
    const rollbackSummary = result.rollbackSummary ?? {
      filesToDelete: [],
      filesAlreadyMissing: [],
      modifiedConflicts: []
    };

    lines.push(`filesToDelete: ${rollbackSummary.filesToDelete.length}`);
    lines.push(`filesAlreadyMissing: ${rollbackSummary.filesAlreadyMissing.length}`);
    lines.push(`modifiedConflicts: ${rollbackSummary.modifiedConflicts.length}`);
  } else {
    lines.push(`filesToCreate: ${result.batch.plan.filesToCreate.length}`);
    lines.push(`filesToModify: ${result.batch.plan.filesToModify.length}`);
    lines.push(`filesToSkip: ${result.batch.plan.filesToSkip.length}`);
  }

  if (dryRun) {
    lines.push("no files written");
  } else if (result.status === "already-initialized") {
    lines.push("written: 0");
    lines.push("next: agent-notes doctor");
  } else if (result.status === "rolled-back") {
    lines.push("written: 0");
    lines.push("rollback: complete");
  } else {
    lines.push(`written: ${result.result.written.length}`);
  }

  return `${lines.join("\n")}\n`;
}

function headlineFor(status: InitResult["status"], dryRun: boolean): string {
  if (status === "already-initialized") {
    return "Agent Notes already initialized";
  }

  if (status === "resumed") {
    return dryRun ? "Agent Notes init resume dry-run" : "Agent Notes init resume complete";
  }

  if (status === "rolled-back") {
    return dryRun ? "Agent Notes init rollback dry-run" : "Agent Notes init rollback complete";
  }

  return dryRun ? "Agent Notes init dry-run" : "Agent Notes init complete";
}

function formatOutputPath(targetPath: string, dryRun: boolean, label: string): string {
  if (!dryRun) {
    return targetPath;
  }

  return `${path.basename(targetPath)} (redacted ${label})`;
}
