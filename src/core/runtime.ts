import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig, type LoadConfigOptions } from "./config.js";
import { AgentNotesError, ErrorCode } from "./errors.js";
import { canonicalizePath } from "./paths.js";
import { parseProjectMap, type ProjectMap, type ProjectMapEntry } from "../schemas/projectMap.js";
import type { LocalConfig } from "../schemas/config.js";

export interface AgentNotesRuntime {
  readonly config: LocalConfig;
  readonly projectMap: ProjectMap;
  readonly projectMapPath: string;
  readonly vaultPath: string;
}

export function loadAgentNotesRuntime(context: LoadConfigOptions = {}): AgentNotesRuntime {
  const config = loadConfig(context);

  if (config.sharing.mode !== "personal") {
    throw new AgentNotesError(ErrorCode.FEATURE_UNSUPPORTED, "Phase 1 只支援 personal vault");
  }

  const vaultPath = canonicalizeVaultPath(config.vaultPath, context);

  validateAgentNotesVault(vaultPath);

  const projectMap = readProjectMap(config.projectMapPath);
  const projectMapVaultPath = canonicalizeProjectMapVaultPath(projectMap.vaultPath, context);

  if (!isSamePath(vaultPath, projectMapVaultPath)) {
    throw new AgentNotesError(ErrorCode.PROJECT_MAP_INVALID, "project map vaultPath 與 local config 不一致");
  }

  return {
    config,
    projectMap: {
      ...projectMap,
      vaultPath
    },
    projectMapPath: config.projectMapPath,
    vaultPath
  };
}

export function readProjectMap(projectMapPath: string): ProjectMap {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(projectMapPath, "utf8"));
  } catch {
    throw new AgentNotesError(ErrorCode.PROJECT_MAP_INVALID, "project map 不是有效 JSON");
  }

  return parseProjectMap(parsed);
}

export function findProjectByRepoPath(projectMap: ProjectMap, repoPath: string): ProjectMapEntry | undefined {
  const normalizedRepoPath = path.resolve(repoPath);

  return projectMap.projects.find((project) =>
    project.repoPaths.some((projectRepoPath) => path.resolve(projectRepoPath) === normalizedRepoPath)
  );
}

export function validateAgentNotesVault(vaultPath: string): void {
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    throw new AgentNotesError(ErrorCode.VAULT_NOT_FOUND, "找不到 Agent Notes vault");
  }

  const requiredPaths = [
    ".gitignore",
    path.join("00-Meta", "Systems", "agent-note-protocol.md"),
    "06-Templates"
  ];

  for (const relativePath of requiredPaths) {
    if (!existsSync(path.join(vaultPath, relativePath))) {
      throw new AgentNotesError(ErrorCode.VAULT_NOT_FOUND, `vault 缺少必要檔案: ${relativePath}`);
    }
  }

  assertVaultPrivatePathsIgnored(vaultPath);
}

export function assertVaultPrivatePathsIgnored(vaultPath: string): void {
  const gitignorePath = path.join(vaultPath, ".gitignore");

  if (!existsSync(gitignorePath)) {
    throw new AgentNotesError(ErrorCode.PRIVATE_DATA_RISK, "vault 缺少 .gitignore");
  }

  const gitignore = readFileSync(gitignorePath, "utf8");

  if (!hasGitignoreEntry(gitignore, "private") || !hasGitignoreEntry(gitignore, ".agent-notes")) {
    throw new AgentNotesError(ErrorCode.PRIVATE_DATA_RISK, "vault .gitignore 必須忽略 private/ 與 .agent-notes/");
  }
}

export function hasGitignoreEntry(content: string, entry: string): boolean {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.replaceAll("\\", "/").replace(/^\//u, "").replace(/\/$/u, ""))
    .includes(entry);
}

export function vaultPathFor(runtime: AgentNotesRuntime, relativePath: string): string {
  return path.join(runtime.vaultPath, relativePath);
}

export function vaultRelativePath(runtime: Pick<AgentNotesRuntime, "vaultPath">, targetPath: string): string {
  const relative = path.relative(runtime.vaultPath, targetPath).replaceAll("\\", "/");

  if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "path 不在 Agent Notes vault 內");
  }

  return relative;
}

export function isTrackedMarkdownPath(runtime: Pick<AgentNotesRuntime, "vaultPath">, targetPath: string): boolean {
  const relative = path.relative(runtime.vaultPath, targetPath).replaceAll("\\", "/");

  return (
    relative.endsWith(".md") &&
    relative !== "" &&
    !relative.startsWith("../") &&
    !path.isAbsolute(relative) &&
    !relative.startsWith(".agent-notes/") &&
    !relative.startsWith("private/")
  );
}

export function readTrackedVaultMarkdown(
  runtime: Pick<AgentNotesRuntime, "vaultPath">,
  relativePath: string,
  missingCode: ErrorCode = ErrorCode.PATH_INVALID
): string {
  const targetPath = path.join(runtime.vaultPath, relativePath);

  assertSafeTrackedVaultMarkdown(runtime, targetPath, missingCode);

  return readFileSync(targetPath, "utf8");
}

export function trackedMarkdownFiles(runtime: Pick<AgentNotesRuntime, "vaultPath">): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".agent-notes" || entry.name === "private" || entry.isSymbolicLink()) {
        continue;
      }

      const targetPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(targetPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      if (isSafeTrackedVaultPath(runtime, targetPath)) {
        files.push(targetPath);
      }
    }
  };

  visit(runtime.vaultPath);

  return files;
}

export function assertSafeTrackedVaultMarkdown(
  runtime: Pick<AgentNotesRuntime, "vaultPath">,
  targetPath: string,
  missingCode: ErrorCode = ErrorCode.PATH_INVALID
): void {
  if (!existsSync(targetPath)) {
    throw new AgentNotesError(missingCode, `找不到 tracked Markdown: ${path.basename(targetPath)}`);
  }

  if (!isSafeTrackedVaultPath(runtime, targetPath)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "tracked Markdown path 不安全或指向 vault 外");
  }
}

export function assertSafeVaultWriteTargets(
  runtime: Pick<AgentNotesRuntime, "vaultPath">,
  targetPaths: readonly string[]
): void {
  for (const targetPath of targetPaths) {
    assertSafeVaultWriteTarget(runtime, targetPath);
  }
}

function canonicalizeVaultPath(vaultPath: string, context: LoadConfigOptions): string {
  try {
    return canonicalizePath(vaultPath, {
      ...context,
      mustExist: true
    });
  } catch {
    throw new AgentNotesError(ErrorCode.VAULT_NOT_FOUND, "找不到 Agent Notes vault");
  }
}

function isSafeTrackedVaultPath(runtime: Pick<AgentNotesRuntime, "vaultPath">, targetPath: string): boolean {
  if (!isTrackedMarkdownPath(runtime, targetPath)) {
    return false;
  }

  try {
    const stats = lstatSync(targetPath);

    if (!stats.isFile() || stats.isSymbolicLink()) {
      return false;
    }

    const realVaultPath = realpathSync.native(runtime.vaultPath);
    const realTargetPath = realpathSync.native(targetPath);
    const realRelative = path.relative(realVaultPath, realTargetPath).replaceAll("\\", "/");

    return (
      realRelative !== "" &&
      !realRelative.startsWith("../") &&
      !path.isAbsolute(realRelative) &&
      !realRelative.startsWith(".agent-notes/") &&
      !realRelative.startsWith("private/")
    );
  } catch {
    return false;
  }
}

function assertSafeVaultWriteTarget(runtime: Pick<AgentNotesRuntime, "vaultPath">, targetPath: string): void {
  const relative = path.relative(runtime.vaultPath, targetPath).replaceAll("\\", "/");

  if (relative === "" || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "write target 不在 Agent Notes vault 內");
  }

  const realVaultPath = realpathSync.native(runtime.vaultPath);
  const parentPath = path.dirname(targetPath);
  const ancestors = ancestorPaths(runtime.vaultPath, parentPath);

  for (const ancestor of ancestors) {
    if (!existsSync(ancestor)) {
      continue;
    }

    const stats = lstatSync(ancestor);

    if (stats.isSymbolicLink()) {
      throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "write target parent 不可為 symlink");
    }

    const realAncestor = realpathSync.native(ancestor);
    const realRelative = path.relative(realVaultPath, realAncestor).replaceAll("\\", "/");

    if (realRelative.startsWith("../") || path.isAbsolute(realRelative)) {
      throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "write target parent 指向 vault 外");
    }
  }

  if (!existsSync(targetPath)) {
    return;
  }

  const targetStats = lstatSync(targetPath);

  if (targetStats.isSymbolicLink()) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "write target 不可為 symlink");
  }

  const realTargetPath = realpathSync.native(targetPath);
  const realTargetRelative = path.relative(realVaultPath, realTargetPath).replaceAll("\\", "/");

  if (realTargetRelative.startsWith("../") || path.isAbsolute(realTargetRelative)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, "write target 指向 vault 外");
  }
}

function ancestorPaths(rootPath: string, targetParentPath: string): string[] {
  const relative = path.relative(rootPath, targetParentPath);
  const segments = relative.split(path.sep).filter((segment) => segment !== "");
  const paths = [rootPath];
  let current = rootPath;

  for (const segment of segments) {
    current = path.join(current, segment);
    paths.push(current);
  }

  return paths;
}

function canonicalizeProjectMapVaultPath(vaultPath: string, context: LoadConfigOptions): string {
  try {
    return canonicalizePath(vaultPath, context);
  } catch {
    throw new AgentNotesError(ErrorCode.PROJECT_MAP_INVALID, "project map vaultPath 不可讀");
  }
}

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}
