import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { canonicalizePath, type PathOptions } from "../core/paths.js";
import {
  createOperationId,
  executeWriteBatch,
  prepareWriteBatch,
  type FileWriteInput,
  type PreparedWriteBatch,
  type WriteBatchResult
} from "../core/writeSafety.js";
import { parseProjectMap, type ProjectMap, type ProjectMapEntry } from "../schemas/projectMap.js";

interface ProjectAddOptions {
  readonly repo: string;
  readonly name?: string;
  readonly projectId?: string;
  readonly dryRun?: boolean;
}

interface ProjectRepoOptions {
  readonly repo?: string;
}

export interface ProjectContext extends PathOptions {
  readonly stdout?: (value: string) => void;
}

export interface ProjectAddResult {
  readonly batch: PreparedWriteBatch;
  readonly result: WriteBatchResult;
  readonly entry: ProjectMapEntry;
  readonly repoSummary: RepoSummary;
  readonly status: "planned" | "existing";
}

export interface ProjectListResult {
  readonly projects: readonly ProjectMapEntry[];
  readonly matchedProjectId?: string;
  readonly repoSummary?: RepoSummary;
}

export interface ProjectCheckResult {
  readonly project: ProjectMapEntry;
  readonly repoSummary: RepoSummary;
}

interface RepoSummary {
  readonly basename: string;
  readonly repoId: string;
  readonly shortHash: string;
}

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

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("管理 local/private project map");

  project
    .command("add")
    .description("把 repo 加入 project map")
    .requiredOption("--repo <path>", "repo 路徑")
    .option("--name <name>", "project 顯示名稱")
    .option("--project-id <id>", "指定 project id")
    .option("--dry-run", "只顯示 write plan，不寫入檔案")
    .action(async (options: ProjectAddOptions) => {
      await runProjectAddCommand(options);
    });

  project
    .command("list")
    .description("列出已知 projects")
    .option("--repo <path>", "標示指定 repo 是否已匹配 project")
    .action((options: ProjectRepoOptions) => {
      runProjectListCommand(options);
    });

  project
    .command("check")
    .description("檢查 repo 是否可解析到 project")
    .option("--repo <path>", "repo 路徑，未提供時使用目前工作目錄")
    .action((options: ProjectRepoOptions) => {
      runProjectCheckCommand(options);
    });

  project.action(() => {
    project.outputHelp();
  });
}

export async function runProjectAddCommand(options: ProjectAddOptions, context: ProjectContext = {}): Promise<ProjectAddResult> {
  const result = await runProjectAdd(options, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatProjectAddResult(result, options.dryRun === true));

  return result;
}

export function runProjectListCommand(options: ProjectRepoOptions = {}, context: ProjectContext = {}): ProjectListResult {
  const result = runProjectList(options, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatProjectListResult(result));

  return result;
}

export function runProjectCheckCommand(options: ProjectRepoOptions = {}, context: ProjectContext = {}): ProjectCheckResult {
  const result = runProjectCheck(options, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatProjectCheckResult(result));

  return result;
}

export async function runProjectAdd(options: ProjectAddOptions, context: ProjectContext = {}): Promise<ProjectAddResult> {
  const runtime = loadProjectRuntime(context);
  const repoPath = resolveRepoRoot(options.repo, context);
  const existingEntry = findProjectByRepoPath(runtime.projectMap, repoPath);
  const repoSummary = summarizeRepo(repoPath);
  const operationId = createOperationId("project-add");

  if (existingEntry !== undefined) {
    return {
      batch: prepareWriteBatch({
        command: "project-add",
        operationId,
        writes: []
      }),
      result: {
        operationId,
        written: [],
        skipped: [],
        warnings: []
      },
      entry: existingEntry,
      repoSummary,
      status: "existing"
    };
  }

  const entry = createProjectEntry({
    projectMap: runtime.projectMap,
    repoPath,
    vaultPath: runtime.vaultPath,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    ...(options.name === undefined ? {} : { projectName: options.name })
  });
  const nextProjectMap = {
    ...runtime.projectMap,
    vaultPath: runtime.vaultPath,
    projects: [...runtime.projectMap.projects, entry]
  };
  const writes = buildProjectAddWrites(runtime.projectMapPath, nextProjectMap, runtime.vaultPath, entry);

  assertProjectContextWritesCreateOnly(writes, runtime.projectMapPath);

  const batch = prepareWriteBatch({
    command: "project-add",
    operationId,
    writes
  });
  const writeResult = await executeWriteBatch({
    batch,
    lockFilePath: path.join(runtime.vaultPath, ".agent-notes", "locks", "project-map.lock"),
    backupRootPath: path.join(runtime.vaultPath, ".agent-notes", "backups", operationId),
    dryRun: options.dryRun === true
  });

  return {
    batch,
    result: writeResult,
    entry,
    repoSummary,
    status: "planned"
  };
}

export function runProjectList(options: ProjectRepoOptions = {}, context: ProjectContext = {}): ProjectListResult {
  const runtime = loadProjectRuntime(context);

  if (options.repo === undefined) {
    return {
      projects: runtime.projectMap.projects
    };
  }

  const repoPath = resolveRepoRoot(options.repo, context);
  const matchedProject = findProjectByRepoPath(runtime.projectMap, repoPath);

  return {
    projects: runtime.projectMap.projects,
    repoSummary: summarizeRepo(repoPath),
    ...(matchedProject === undefined ? {} : { matchedProjectId: matchedProject.id })
  };
}

export function runProjectCheck(options: ProjectRepoOptions = {}, context: ProjectContext = {}): ProjectCheckResult {
  const runtime = loadProjectRuntime(context);
  const repoPath = resolveRepoRoot(options.repo ?? ".", context);
  const project = findProjectByRepoPath(runtime.projectMap, repoPath);

  if (project === undefined) {
    throw new AgentNotesError(ErrorCode.PROJECT_NOT_FOUND, "repo 尚未加入 project map，請執行 project add");
  }

  return {
    project,
    repoSummary: summarizeRepo(repoPath)
  };
}

function loadProjectRuntime(context: ProjectContext): {
  readonly projectMap: ProjectMap;
  readonly projectMapPath: string;
  readonly vaultPath: string;
} {
  const config = loadConfig(context);

  if (config.sharing.mode !== "personal") {
    throw new AgentNotesError(ErrorCode.FEATURE_UNSUPPORTED, "Phase 1 只支援 personal project map");
  }

  const vaultPath = canonicalizeVaultPath(config.vaultPath, context);

  validateAgentNotesVault(vaultPath);

  const projectMap = loadProjectMap(config.projectMapPath);
  const projectMapVaultPath = canonicalizeProjectMapVaultPath(projectMap.vaultPath, context);

  if (!isSamePath(vaultPath, projectMapVaultPath)) {
    throw new AgentNotesError(ErrorCode.PROJECT_MAP_INVALID, "project map vaultPath 與 local config 不一致");
  }

  return {
    projectMap: {
      ...projectMap,
      vaultPath
    },
    projectMapPath: config.projectMapPath,
    vaultPath
  };
}

function loadProjectMap(projectMapPath: string): ProjectMap {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(projectMapPath, "utf8"));
  } catch {
    throw new AgentNotesError(ErrorCode.PROJECT_MAP_INVALID, "project map 不是有效 JSON");
  }

  return parseProjectMap(parsed);
}

function resolveRepoRoot(repoPathInput: string, context: ProjectContext): string {
  let repoPath: string;

  try {
    repoPath = canonicalizePath(repoPathInput, {
      ...context,
      mustExist: true
    });
  } catch {
    throw new AgentNotesError(ErrorCode.PATH_INVALID, "repo path 不存在或不可讀");
  }

  if (!statSync(repoPath).isDirectory()) {
    throw new AgentNotesError(ErrorCode.PATH_INVALID, "repo path 不是目錄");
  }

  try {
    return canonicalizePath(
      execFileSync("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim(),
      context
    );
  } catch {
    return repoPath;
  }
}

function createProjectEntry(input: {
  readonly projectMap: ProjectMap;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly repoPath: string;
  readonly vaultPath: string;
}): ProjectMapEntry {
  const name = input.projectName?.trim() || displayNameForRepo(input.repoPath);
  const repoId = nextAvailableSlug(slugify(path.basename(input.repoPath)), new Set(input.projectMap.projects.map((project) => project.repoId)));
  const requestedProjectId = input.projectId === undefined ? undefined : slugify(input.projectId);
  const projectId =
    requestedProjectId === undefined
      ? nextAvailableSlug(repoId, new Set(input.projectMap.projects.map((project) => project.id)))
      : ensureExplicitProjectIdAvailable(requestedProjectId, input.projectMap);
  const notePath = nextAvailableNotePath(
    path.posix.join("03-Projects", safeProjectDirectoryName(name)),
    new Set(input.projectMap.projects.map((project) => normalizeVaultRelativePath(project.notePath)))
  );

  return {
    id: projectId,
    name,
    repoId,
    repoPaths: [input.repoPath],
    notePath,
    tags: [projectId],
    visibility: "private"
  };
}

function ensureExplicitProjectIdAvailable(projectId: string, projectMap: ProjectMap): string {
  if (projectMap.projects.some((project) => project.id === projectId)) {
    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `project id 已存在: ${projectId}`);
  }

  return projectId;
}

function buildProjectAddWrites(
  projectMapPath: string,
  projectMap: ProjectMap,
  vaultPath: string,
  entry: ProjectMapEntry
): FileWriteInput[] {
  const projectDirectory = path.join(vaultPath, entry.notePath);
  const render = (template: string): string => template.replaceAll("{{projectName}}", entry.name);

  return [
    {
      targetPath: projectMapPath,
      content: `${JSON.stringify(projectMap, null, 2)}\n`,
      backupKey: "project-map.json"
    },
    {
      targetPath: path.join(projectDirectory, "README.md"),
      content: render(projectReadmeTemplate),
      backupKey: path.posix.join(entry.notePath, "README.md")
    },
    {
      targetPath: path.join(projectDirectory, "active-tasks.md"),
      content: activeTasksTemplate,
      backupKey: path.posix.join(entry.notePath, "active-tasks.md")
    },
    {
      targetPath: path.join(projectDirectory, "decision-log.md"),
      content: decisionLogTemplate,
      backupKey: path.posix.join(entry.notePath, "decision-log.md")
    },
    {
      targetPath: path.join(projectDirectory, "pitfalls.md"),
      content: pitfallsTemplate,
      backupKey: path.posix.join(entry.notePath, "pitfalls.md")
    }
  ];
}

function assertProjectContextWritesCreateOnly(writes: readonly FileWriteInput[], projectMapPath: string): void {
  const projectMapTarget = path.resolve(projectMapPath);

  for (const write of writes) {
    if (path.resolve(write.targetPath) === projectMapTarget || !existsSync(write.targetPath)) {
      continue;
    }

    if (readFileSync(write.targetPath, "utf8") === write.content) {
      continue;
    }

    throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, `project context file 已存在，拒絕覆寫: ${write.backupKey ?? path.basename(write.targetPath)}`);
  }
}

function findProjectByRepoPath(projectMap: ProjectMap, repoPath: string): ProjectMapEntry | undefined {
  const normalizedRepoPath = path.resolve(repoPath);

  return projectMap.projects.find((project) =>
    project.repoPaths.some((projectRepoPath) => path.resolve(projectRepoPath) === normalizedRepoPath)
  );
}

function summarizeRepo(repoPath: string): RepoSummary {
  const basename = path.basename(repoPath);

  return {
    basename,
    repoId: slugify(basename),
    shortHash: createHash("sha256").update(repoPath).digest("hex").slice(0, 8)
  };
}

function displayNameForRepo(repoPath: string): string {
  return path.basename(repoPath)
    .split(/[-_ ]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return slug || "project";
}

function nextAvailableSlug(baseSlug: string, usedSlugs: ReadonlySet<string>): string {
  if (!usedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${baseSlug}-${index}`;

    if (!usedSlugs.has(candidate)) {
      return candidate;
    }
  }
}

function nextAvailableNotePath(baseNotePath: string, usedNotePaths: ReadonlySet<string>): string {
  const normalizedBase = normalizeVaultRelativePath(baseNotePath);

  if (!usedNotePaths.has(normalizedBase)) {
    return normalizedBase;
  }

  const parsed = path.posix.parse(normalizedBase);

  for (let index = 2; ; index += 1) {
    const candidate = normalizeVaultRelativePath(path.posix.join(parsed.dir, `${parsed.base}-${index}`));

    if (!usedNotePaths.has(candidate)) {
      return candidate;
    }
  }
}

function normalizeVaultRelativePath(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/"));
}

function safeProjectDirectoryName(value: string): string {
  const normalized = value.replaceAll("\\", "-").replaceAll("/", "-").replaceAll(":", "-").trim();

  return normalized === "" || normalized === "." || normalized === ".." ? "Project" : normalized;
}

function canonicalizeVaultPath(vaultPath: string, context: ProjectContext): string {
  try {
    return canonicalizePath(vaultPath, {
      ...context,
      mustExist: true
    });
  } catch {
    throw new AgentNotesError(ErrorCode.VAULT_NOT_FOUND, "找不到 Agent Notes vault");
  }
}

function canonicalizeProjectMapVaultPath(vaultPath: string, context: ProjectContext): string {
  try {
    return canonicalizePath(vaultPath, context);
  } catch {
    throw new AgentNotesError(ErrorCode.PROJECT_MAP_INVALID, "project map vaultPath 不可讀");
  }
}

function validateAgentNotesVault(vaultPath: string): void {
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    throw new AgentNotesError(ErrorCode.VAULT_NOT_FOUND, "找不到 Agent Notes vault");
  }

  if (
    !existsSync(path.join(vaultPath, ".gitignore")) ||
    !existsSync(path.join(vaultPath, "00-Meta", "Systems", "agent-note-protocol.md")) ||
    !existsSync(path.join(vaultPath, "06-Templates"))
  ) {
    throw new AgentNotesError(ErrorCode.VAULT_NOT_FOUND, "vault 缺少 Agent Notes 必要檔案");
  }

  assertVaultPrivatePathsIgnored(vaultPath);
}

function assertVaultPrivatePathsIgnored(vaultPath: string): void {
  const gitignore = readFileSync(path.join(vaultPath, ".gitignore"), "utf8");

  if (!hasGitignoreEntry(gitignore, "private") || !hasGitignoreEntry(gitignore, ".agent-notes")) {
    throw new AgentNotesError(ErrorCode.PRIVATE_DATA_RISK, "vault .gitignore 必須忽略 private/ 與 .agent-notes/");
  }
}

function hasGitignoreEntry(content: string, entry: string): boolean {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.replaceAll("\\", "/").replace(/^\//u, "").replace(/\/$/u, ""))
    .includes(entry);
}

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function formatProjectAddResult(result: ProjectAddResult, dryRun: boolean): string {
  return [
    result.status === "existing" ? "Agent Notes project already added" : dryRun ? "Agent Notes project add dry-run" : "Agent Notes project add complete",
    `projectId: ${result.entry.id}`,
    `name: ${result.entry.name}`,
    `repoId: ${result.entry.repoId}`,
    `repo: ${result.repoSummary.basename}#${result.repoSummary.shortHash}`,
    `notePath: ${result.entry.notePath}`,
    ...(dryRun
      ? [
          `directory: ${result.entry.notePath}`,
          "contextTemplates:",
          ...projectContextTemplatePaths(result.entry).map((templatePath) => `- ${templatePath}`)
        ]
      : []),
    `filesToCreate: ${result.batch.plan.filesToCreate.length}`,
    `filesToModify: ${result.batch.plan.filesToModify.length}`,
    `filesToSkip: ${result.batch.plan.filesToSkip.length}`,
    dryRun ? "no files written" : `written: ${result.result.written.length}`
  ].join("\n") + "\n";
}

function formatProjectListResult(result: ProjectListResult): string {
  const lines = ["Agent Notes projects"];

  if (result.projects.length === 0) {
    lines.push("empty: true");
  } else {
    for (const project of result.projects) {
      lines.push(`${project.id} | ${project.name} | repoId=${project.repoId} | notePath=${project.notePath} | visibility=${project.visibility}`);
    }
  }

  if (result.repoSummary !== undefined) {
    lines.push(`repo: ${result.repoSummary.basename}#${result.repoSummary.shortHash}`);
    lines.push(`matched: ${result.matchedProjectId ?? "none"}`);

    if (result.matchedProjectId === undefined) {
      lines.push('next: cd to that repo, then run agent-notes project add --repo "$PWD"');
    }
  } else if (result.projects.length === 0) {
    lines.push('next: agent-notes project add --repo "$PWD"');
  }

  return `${lines.join("\n")}\n`;
}

function projectContextTemplatePaths(entry: ProjectMapEntry): string[] {
  return [
    path.posix.join(entry.notePath, "README.md"),
    path.posix.join(entry.notePath, "active-tasks.md"),
    path.posix.join(entry.notePath, "decision-log.md"),
    path.posix.join(entry.notePath, "pitfalls.md")
  ];
}

function formatProjectCheckResult(result: ProjectCheckResult): string {
  return [
    "Agent Notes project check",
    `projectId: ${result.project.id}`,
    `name: ${result.project.name}`,
    `repoId: ${result.project.repoId}`,
    `repo: ${result.repoSummary.basename}#${result.repoSummary.shortHash}`,
    `notePath: ${result.project.notePath}`,
    `visibility: ${result.project.visibility}`
  ].join("\n") + "\n";
}
