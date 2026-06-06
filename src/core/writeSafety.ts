import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentNotesError, ErrorCode } from "./errors.js";

export interface FileWriteInput {
  readonly targetPath: string;
  readonly content: string;
  readonly backupKey?: string;
}

export interface PreparedFileWrite extends FileWriteInput {
  readonly expectedHash: string | null;
}

export interface RollbackPlan {
  readonly created: readonly string[];
  readonly modified: readonly {
    readonly targetPath: string;
    readonly backupKey: string;
  }[];
}

export interface WritePlan {
  readonly operationId: string;
  readonly command: string;
  readonly filesToCreate: readonly string[];
  readonly filesToModify: readonly string[];
  readonly filesToSkip: readonly string[];
  readonly publicSafeScanTargets: readonly string[];
  readonly rollbackPlan: RollbackPlan;
}

export interface PreparedWriteBatch {
  readonly plan: WritePlan;
  readonly plannedWrites: readonly PreparedFileWrite[];
  readonly writes: readonly PreparedFileWrite[];
}

export interface ExecuteWriteBatchOptions {
  readonly batch: PreparedWriteBatch;
  readonly lockFilePath: string;
  readonly backupRootPath: string;
  readonly dryRun?: boolean;
  readonly beforeApply?: () => Promise<void> | void;
  readonly afterApply?: () => Promise<void> | void;
  readonly onFailure?: (context: { readonly written: readonly string[] }) => Promise<void> | void;
}

export interface WriteBatchResult {
  readonly operationId: string;
  readonly written: readonly string[];
  readonly skipped: readonly string[];
  readonly warnings: readonly string[];
}

interface LockHandle {
  readonly operationId: string;
  readonly lockFilePath: string;
}

export interface WriteLockOptions<T> {
  readonly lockFilePath: string;
  readonly operationId: string;
  readonly command: string;
  readonly action: () => Promise<T> | T;
}

export function createOperationId(command: string): string {
  const commandSlug = command.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "operation";

  return `${commandSlug}-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
}

export function prepareWriteBatch(input: {
  readonly command: string;
  readonly writes: readonly FileWriteInput[];
  readonly operationId?: string;
  readonly publicSafeScanTargets?: readonly string[];
}): PreparedWriteBatch {
  const operationId = validateOperationId(input.operationId ?? createOperationId(input.command));
  const preparedWrites = input.writes.map((write) => prepareFileWrite(write));
  const publicSafeScanTargets = (input.publicSafeScanTargets ?? []).map((targetPath) => path.resolve(targetPath));
  const filesToCreate: string[] = [];
  const filesToModify: string[] = [];
  const filesToSkip: string[] = [];
  const created: string[] = [];
  const modified: {
    readonly targetPath: string;
    readonly backupKey: string;
  }[] = [];
  const targetPaths = new Set<string>();
  const modifiedBackupKeys = new Set<string>();

  for (const write of preparedWrites) {
    if (targetPaths.has(write.targetPath)) {
      throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `duplicate target path: ${write.targetPath}`);
    }

    targetPaths.add(write.targetPath);

    if (write.expectedHash === null) {
      filesToCreate.push(write.targetPath);
      created.push(write.targetPath);
      continue;
    }

    if (readFileSync(write.targetPath, "utf8") === write.content) {
      filesToSkip.push(write.targetPath);
      continue;
    }

    const backupKey = backupKeyFor(write);

    if (modifiedBackupKeys.has(backupKey)) {
      throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `duplicate backup key: ${backupKey}`);
    }

    modifiedBackupKeys.add(backupKey);
    filesToModify.push(write.targetPath);
    modified.push({
      targetPath: write.targetPath,
      backupKey
    });
  }

  const writesToApply = preparedWrites.filter((write) => !filesToSkip.includes(write.targetPath));

  return {
    plan: {
      operationId,
      command: input.command,
      filesToCreate,
      filesToModify,
      filesToSkip,
      publicSafeScanTargets,
      rollbackPlan: {
        created,
        modified
      }
    },
    plannedWrites: preparedWrites,
    writes: writesToApply
  };
}

export async function executeWriteBatch(options: ExecuteWriteBatchOptions): Promise<WriteBatchResult> {
  const { batch } = options;

  validatePublicSafeTargets(batch);

  if (options.dryRun === true) {
    return {
      operationId: batch.plan.operationId,
      written: [],
      skipped: batch.plan.filesToSkip,
      warnings: []
    };
  }

  let lockHandle: LockHandle | undefined;
  let lockAcquired = false;
  const written: PreparedFileWrite[] = [];
  const warnings: string[] = [];

  try {
    lockHandle = await acquireLock(options.lockFilePath, batch.plan.operationId, batch.plan.command);
    lockAcquired = true;
    await options.beforeApply?.();
    await verifyExpectedHashes(batch.writes);
    await backupModifiedFiles(batch.writes, options.backupRootPath);

    for (const write of batch.writes) {
      await atomicWrite(write.targetPath, write.content, batch.plan.operationId);
      written.push(write);
    }

    await options.afterApply?.();

    return {
      operationId: batch.plan.operationId,
      written: written.map((write) => write.targetPath),
      skipped: batch.plan.filesToSkip,
      warnings
    };
  } catch (error) {
    if (written.length > 0) {
      await rollbackWrites(written, options.backupRootPath).catch((rollbackError: unknown) => {
        warnings.push(`rollback failed: ${messageFor(rollbackError)}`);
      });
    }

    if (lockAcquired) {
      await Promise.resolve(options.onFailure?.({ written: written.map((write) => write.targetPath) })).catch((failureCleanupError: unknown) => {
        warnings.push(`failure cleanup failed: ${messageFor(failureCleanupError)}`);
      });
    }

    const warningSuffix = warnings.length > 0 ? `; warnings: ${warnings.join("; ")}` : "";

    if (error instanceof AgentNotesError) {
      throw warningSuffix === "" ? error : new AgentNotesError(error.code, `${error.message}${warningSuffix}`);
    }

    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `${messageFor(error)}${warningSuffix}`);
  } finally {
    if (lockHandle !== undefined) {
      await releaseLock(lockHandle).catch((error: unknown) => {
        warnings.push(`lock release failed: ${messageFor(error)}`);
      });
    }
  }
}

export function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function withWriteLock<T>(options: WriteLockOptions<T>): Promise<T> {
  let lockHandle: LockHandle | undefined;

  try {
    lockHandle = await acquireLock(options.lockFilePath, options.operationId, options.command);

    return await options.action();
  } finally {
    if (lockHandle !== undefined) {
      await releaseLock(lockHandle);
    }
  }
}

function prepareFileWrite(write: FileWriteInput): PreparedFileWrite {
  const targetPath = path.resolve(write.targetPath);

  return {
    ...write,
    targetPath,
    expectedHash: existsSync(targetPath) ? hashContent(readFileSync(targetPath, "utf8")) : null
  };
}

function backupKeyFor(write: FileWriteInput): string {
  return normalizeBackupKey(write.backupKey ?? defaultBackupKeyFor(write.targetPath));
}

function defaultBackupKeyFor(targetPath: string): string {
  const digest = createHash("sha256").update(path.resolve(targetPath)).digest("hex").slice(0, 16);

  return path.posix.join(digest, path.basename(targetPath));
}

function normalizeBackupKey(backupKey: string): string {
  const slashNormalized = backupKey.replaceAll("\\", "/");
  const segments = slashNormalized.split("/");
  const normalized = path.posix.normalize(slashNormalized);

  if (
    backupKey.trim() === "" ||
    backupKey.includes("\0") ||
    path.posix.isAbsolute(slashNormalized) ||
    path.win32.isAbsolute(backupKey) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    segments.some((segment) => segment === "" || segment === "..")
  ) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "backup key 必須是安全的相對路徑");
  }

  return normalized;
}

function validateOperationId(operationId: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(operationId)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "operationId 含不安全字元");
  }

  return operationId;
}

async function acquireLock(lockFilePath: string, operationId: string, command: string): Promise<LockHandle> {
  await mkdir(path.dirname(lockFilePath), {
    recursive: true
  });

  let fileHandle;

  try {
    fileHandle = await open(lockFilePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, "write lock 已存在");
    }

    throw error;
  }

  await fileHandle.writeFile(
    JSON.stringify(
      {
        operationId,
        command,
        createdAt: new Date().toISOString(),
        pid: process.pid
      },
      null,
      2
    )
  );
  await fileHandle.close();

  return {
    operationId,
    lockFilePath
  };
}

async function releaseLock(lockHandle: LockHandle): Promise<void> {
  const rawLock = await readFile(lockHandle.lockFilePath, "utf8");
  const lock = JSON.parse(rawLock) as {
    readonly operationId?: string;
  };

  if (lock.operationId === lockHandle.operationId) {
    await rm(lockHandle.lockFilePath, {
      force: true
    });
  }
}

async function verifyExpectedHashes(writes: readonly PreparedFileWrite[]): Promise<void> {
  for (const write of writes) {
    const existsNow = existsSync(write.targetPath);

    if (write.expectedHash === null) {
      if (existsNow) {
        throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `target appeared after planning: ${write.targetPath}`);
      }

      continue;
    }

    if (!existsNow) {
      throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `target disappeared after planning: ${write.targetPath}`);
    }

    const currentHash = hashContent(await readFile(write.targetPath, "utf8"));

    if (currentHash !== write.expectedHash) {
      throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `target changed after planning: ${write.targetPath}`);
    }
  }
}

async function backupModifiedFiles(writes: readonly PreparedFileWrite[], backupRootPath: string): Promise<void> {
  for (const write of writes) {
    if (write.expectedHash === null) {
      continue;
    }

    const backupPath = path.join(backupRootPath, backupKeyFor(write));

    try {
      await mkdir(path.dirname(backupPath), {
        recursive: true
      });
      await writeFile(backupPath, await readFile(write.targetPath));
    } catch (error) {
      throw new AgentNotesError(ErrorCode.BACKUP_FAILED, messageFor(error));
    }
  }
}

async function atomicWrite(targetPath: string, content: string, operationId: string): Promise<void> {
  await mkdir(path.dirname(targetPath), {
    recursive: true
  });

  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${operationId}.tmp`);

  try {
    await writeFile(tempPath, content);
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, {
      force: true
    }).catch(() => {});
    throw error;
  }
}

function validatePublicSafeTargets(batch: PreparedWriteBatch): void {
  if (batch.plan.publicSafeScanTargets.length === 0) {
    return;
  }

  const scanTargets = new Set(batch.plan.publicSafeScanTargets.map((targetPath) => path.resolve(targetPath)));

  for (const write of batch.plannedWrites) {
    if (!scanTargets.has(write.targetPath)) {
      continue;
    }

    const risk = findPublicSafeRisk(write.content);

    if (risk !== undefined) {
      throw new AgentNotesError(
        ErrorCode.PRIVATE_DATA_RISK,
        `public-safe target contains blocked pattern: ${path.basename(write.targetPath)} (${risk})`
      );
    }
  }
}

const publicSafeBlockingPatterns = [
  {
    label: "local absolute path",
    pattern: /(^|[\s"'`=])(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])/u
  },
  {
    label: "home path alias",
    pattern: /(^|[\s"'`=])(?:~\/|\$HOME(?:\/|\b)|\$\{HOME\}(?:\/|\b))/u
  },
  {
    label: "private path",
    pattern: /(^|[\\/.\s"'`])(?:\.agent-notes|private)(?:[\\/]|$)/u
  },
  {
    label: "credential file",
    pattern: /(^|[\\/.\s])(?:\.env(?:\.[\w-]+)?|\.npmrc|credentials?\.json|service-account(?:\.json)?)(?:$|[\s"'`\\/,])/u
  },
  {
    label: "token prefix",
    pattern: /\b(?:sk-[A-Za-z0-9]|ghp_[A-Za-z0-9]|xox[A-Za-z0-9-]*|AKIA[0-9A-Z]{4,}|AIza[0-9A-Za-z_-]+)/u
  },
  {
    label: "local pointer field",
    pattern: /\b(?:sourceFilePath|repoPath|vaultPath|projectMapPath|homePath)\s*[:=]/u
  },
  {
    label: "raw transcript",
    pattern: /\braw transcript\b|rawIncluded\s*:\s*true|private\/raw-sessions/u
  }
] as const;

function findPublicSafeRisk(content: string): string | undefined {
  const normalizedContent = content.replaceAll("\\", "/");

  return publicSafeBlockingPatterns.find(({ pattern }) => pattern.test(normalizedContent))?.label;
}

async function rollbackWrites(writes: readonly PreparedFileWrite[], backupRootPath: string): Promise<void> {
  const failures: string[] = [];

  for (const write of [...writes].reverse()) {
    try {
      if (write.expectedHash === null) {
        await removeCreatedWriteIfUnchanged(write);
        continue;
      }

      const backupPath = path.join(backupRootPath, backupKeyFor(write));
      await mkdir(path.dirname(write.targetPath), {
        recursive: true
      });
      await writeFile(write.targetPath, await readFile(backupPath));
    } catch (error) {
      failures.push(`${path.basename(write.targetPath)}: ${messageFor(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `rollback incomplete: ${failures.join("; ")}`);
  }
}

async function removeCreatedWriteIfUnchanged(write: PreparedFileWrite): Promise<void> {
  if (!existsSync(write.targetPath)) {
    return;
  }

  const currentHash = hashContent(await readFile(write.targetPath, "utf8"));

  if (currentHash !== hashContent(write.content)) {
    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `created target changed before rollback: ${write.targetPath}`);
  }

  await rm(write.targetPath, {
    force: true
  });
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);

    return true;
  } catch {
    return false;
  }
}
