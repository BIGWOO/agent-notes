import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { updateMarkerBlock } from "../core/markerBlocks.js";
import type { CandidateGeneratedItem, TouchedGeneratedItem } from "../core/markerBlocks.js";
import {
  escapeYamlString,
  extractSectionListItems,
  firstSummaryItem,
  parseSummaryFile,
  type SummarySections
} from "../core/markdown.js";
import { resolvePath, type PathOptions } from "../core/paths.js";
import {
  appendProvenanceEntries,
  loadProvenanceLog,
  loadSourceIndex,
  provenanceLogPath,
  renderSourceIndex,
  sourceIndexPath
} from "../core/provenanceStore.js";
import {
  findProjectByRepoPath,
  assertSafeVaultWriteTargets,
  isTrackedMarkdownPath,
  loadAgentNotesRuntime,
  readTrackedVaultMarkdown,
  vaultPathFor,
  type AgentNotesRuntime
} from "../core/runtime.js";
import { hashContent, createOperationId, executeWriteBatch, prepareWriteBatch, type PreparedWriteBatch, type WriteBatchResult } from "../core/writeSafety.js";
import { parseSessionFrontmatter } from "../schemas/session.js";
import type { ProjectMapEntry } from "../schemas/projectMap.js";
import type { ProvenanceEntry, SourceIndex } from "../schemas/provenance.js";
import { resolveRepoRoot } from "./project.js";

interface CaptureOptions {
  readonly dryRun?: boolean;
  readonly includeRaw?: boolean;
  readonly repo?: string;
  readonly scope?: string;
  readonly sourceFile?: string;
  readonly summaryFile?: string;
  readonly tool?: string;
  readonly visibility?: string;
}

export interface CaptureContext extends PathOptions {
  readonly now?: Date;
  readonly operationId?: string;
  readonly stdout?: (value: string) => void;
}

export interface CaptureResult {
  readonly batch: PreparedWriteBatch;
  readonly result: WriteBatchResult;
  readonly route: CaptureRoute;
  readonly sessionId?: string;
  readonly sessionNotePath?: string;
  readonly sourceRef?: string;
  readonly touchedItems: readonly TouchedGeneratedItem[];
}

type CaptureScope = "area" | "daily" | "ignore" | "inbox" | "personal" | "project";
type WritableCaptureScope = Exclude<CaptureScope, "ignore">;
type CaptureVisibility = "private" | "public-safe" | "team-safe";

interface RenderSessionFrontmatter {
  readonly agent: string;
  readonly capturedAt: string;
  readonly date: string;
  readonly derivedItems: {
    readonly contextUpdates: readonly string[];
    readonly decisions: readonly string[];
    readonly pitfalls: readonly string[];
    readonly tasks: readonly string[];
  };
  readonly notePath: string;
  readonly project?: string;
  readonly projectId?: string;
  readonly repoId?: string;
  readonly schemaVersion: 1;
  readonly scope: WritableCaptureScope;
  readonly sessionId: string;
  readonly source: {
    readonly kind: "summary-file";
    readonly rawIncluded: false;
    readonly ref: string;
  };
  readonly sourceRefs: readonly string[];
  readonly status: "done" | "handoff";
  readonly tags: readonly string[];
  readonly title: string;
  readonly tool: string;
  readonly type: "agent-session";
  readonly visibility: CaptureVisibility;
}

interface CaptureRoute {
  readonly reason: string;
  readonly scope: CaptureScope;
  readonly project?: ProjectMapEntry;
}

interface CaptureIds {
  readonly capturedAt: string;
  readonly date: string;
  readonly dateStamp: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly sourceRef: string;
  readonly toolSlug: string;
}

export function registerCaptureCommand(program: Command): void {
  program
    .command("capture")
    .description("依 summary file 建立 session note 與 provenance")
    .option("--repo <path>", "repo 路徑")
    .option("--tool <tool>", "agent tool，例如 codex")
    .option("--scope <scope>", "寫入範圍：ignore、inbox、daily、area、personal、project")
    .option("--summary-file <path>", "deterministic Markdown summary file")
    .option("--visibility <visibility>", "visibility：private、team-safe、public-safe")
    .option("--source-file <path>", "本機 source pointer，不複製 raw transcript")
    .option("--include-raw", "Phase 1 不支援 raw transcript copy")
    .option("--dry-run", "只顯示 write plan，不寫入檔案")
    .action(async (options: CaptureOptions) => {
      await runCaptureCommand(options);
    });
}

export async function runCaptureCommand(options: CaptureOptions, context: CaptureContext = {}): Promise<CaptureResult> {
  const result = await runCapture(options, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(formatCaptureResult(result, options.dryRun === true));

  return result;
}

export async function runCapture(options: CaptureOptions, context: CaptureContext = {}): Promise<CaptureResult> {
  if (options.includeRaw === true) {
    throw new AgentNotesError(ErrorCode.FEATURE_UNSUPPORTED, "Phase 1 不支援 raw transcript copy");
  }

  const runtime = loadAgentNotesRuntime(context);
  const requestedScope = parseScope(options.scope);
  const route = resolveCaptureRoute(runtime, requestedScope, options.repo, context);
  const operationId = context.operationId ?? createOperationId("capture");

  if (route.scope === "ignore") {
    const batch = prepareWriteBatch({
      command: "capture",
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
      route,
      touchedItems: []
    };
  }

  if (options.summaryFile === undefined || options.summaryFile.trim() === "") {
    throw new AgentNotesError(ErrorCode.INVALID_SUMMARY_FILE, "capture 需要 --summary-file");
  }

  const visibility = parseVisibility(options.visibility ?? runtime.config.privacy.defaultVisibility);
  const tool = slugifyTool(options.tool ?? "codex");
  const summaryFilePath = resolveExistingFile(options.summaryFile, context, ErrorCode.INVALID_SUMMARY_FILE);
  const sourceFilePath =
    options.sourceFile === undefined ? summaryFilePath : resolveExistingFile(options.sourceFile, context, ErrorCode.SOURCE_FILE_NOT_FOUND);
  const summaryContent = readFileSync(summaryFilePath, "utf8");
  const parsedSummary = parseSummaryFile(summaryContent);
  const sourceIndex = loadSourceIndex(runtime.vaultPath);
  const provenanceLog = loadProvenanceLog(runtime.vaultPath);
  const ids = createCaptureIds({
    now: context.now ?? new Date(),
    provenanceLog,
    sourceIndex,
    tool
  });
  const markerPlan = route.scope === "project" && route.project !== undefined ? planProjectMarkerUpdates(runtime, route.project, parsedSummary.sections, ids) : [];
  const touchedItems = markerPlan.flatMap((plan) => plan.result.touchedItems);
  const sessionNotePath = sessionNotePathFor(route, ids);
  const sessionCard = renderSessionCard({
    ids,
    route,
    sections: parsedSummary.sections,
    sessionNotePath,
    sourceContentHash: hashContent(summaryContent),
    sourceRef: ids.sourceRef,
    tool,
    touchedItems,
    visibility
  });

  const nextSourceIndex = addSourceIndexEntry({
    capturedAt: ids.capturedAt,
    contentHash: hashContent(summaryContent),
    localPath: sourceFilePath,
    sessionId: ids.sessionId,
    sourceIndex,
    sourceRef: ids.sourceRef,
    tool,
    visibility
  });
  const nextProvenanceEntries = buildProvenanceEntries({
    capturedAt: ids.capturedAt,
    sessionCard,
    sessionId: ids.sessionId,
    sessionNotePath,
    sourceRef: ids.sourceRef,
    touchedItems
  });
  const writes = [
    {
      targetPath: vaultPathFor(runtime, sessionNotePath),
      content: sessionCard,
      backupKey: sessionNotePath
    },
    {
      targetPath: sourceIndexPath(runtime.vaultPath),
      content: renderSourceIndex(nextSourceIndex),
      backupKey: ".agent-notes/source-index.json"
    },
    {
      targetPath: provenanceLogPath(runtime.vaultPath),
      content: appendProvenanceEntries(provenanceLog, nextProvenanceEntries),
      backupKey: ".agent-notes/provenance.jsonl"
    },
    ...markerPlan.map((plan) => ({
      targetPath: plan.targetPath,
      content: plan.result.content,
      backupKey: plan.notePath
    }))
  ];
  const publicSafeScanTargets =
    visibility === "private"
      ? []
      : writes
          .map((write) => path.resolve(write.targetPath))
          .filter((targetPath) => isTrackedMarkdownPath(runtime, targetPath));
  assertSafeVaultWriteTargets(
    runtime,
    writes.map((write) => write.targetPath)
  );
  const batch = prepareWriteBatch({
    command: "capture",
    operationId,
    publicSafeScanTargets,
    writes
  });
  const writeResult = await executeWriteBatch({
    batch,
    lockFilePath: path.join(runtime.vaultPath, ".agent-notes", "locks", "capture.lock"),
    backupRootPath: path.join(runtime.vaultPath, ".agent-notes", "backups", operationId),
    dryRun: options.dryRun === true
  });

  return {
    batch,
    result: writeResult,
    route,
    sessionId: ids.sessionId,
    sessionNotePath,
    sourceRef: ids.sourceRef,
    touchedItems
  };
}

function resolveCaptureRoute(
  runtime: AgentNotesRuntime,
  requestedScope: CaptureScope | undefined,
  repoInput: string | undefined,
  context: CaptureContext
): CaptureRoute {
  if (requestedScope === "ignore") {
    return {
      reason: "explicit ignore",
      scope: "ignore"
    };
  }

  const repoPath = repoInput === undefined ? undefined : resolveRepoRoot(repoInput, context);
  const project = repoPath === undefined ? undefined : findProjectByRepoPath(runtime.projectMap, repoPath);

  if (requestedScope === "project") {
    if (project === undefined) {
      throw new AgentNotesError(ErrorCode.PROJECT_NOT_FOUND, "scope=project 需要 repo 已加入 project map");
    }

    return {
      project,
      reason: "explicit project",
      scope: "project"
    };
  }

  if (requestedScope !== undefined) {
    return {
      reason: "explicit scope",
      scope: requestedScope
    };
  }

  if (project !== undefined) {
    return {
      project,
      reason: "repo matched project",
      scope: "project"
    };
  }

  return {
    reason: repoPath === undefined ? "default inbox" : "repo not in project map",
    scope: "inbox"
  };
}

function planProjectMarkerUpdates(
  runtime: AgentNotesRuntime,
  project: ProjectMapEntry,
  sections: SummarySections,
  ids: CaptureIds
): {
  readonly notePath: string;
  readonly result: ReturnType<typeof updateMarkerBlock>;
  readonly targetPath: string;
}[] {
  const sourceRefs = [ids.sourceRef];
  const plans: {
    readonly blockId: string;
    readonly candidates: readonly CandidateGeneratedItem[];
    readonly notePath: string;
  }[] = [
    {
      blockId: "project-summary",
      candidates: [
        {
          derivedFrom: "summary-file:Summary",
          itemType: "context-update",
          sessionId: ids.sessionId,
          sourceRefs,
          title: firstSummaryItem(sections.Summary)
        }
      ],
      notePath: path.posix.join(project.notePath, "README.md")
    },
    {
      blockId: "decision-log",
      candidates: extractSectionListItems(sections.Decisions).map((title) => ({
        derivedFrom: "summary-file:Decisions",
        itemType: "decision",
        sessionId: ids.sessionId,
        sourceRefs,
        status: "accepted",
        title
      })),
      notePath: path.posix.join(project.notePath, "decision-log.md")
    },
    {
      blockId: "active-tasks",
      candidates: extractSectionListItems(sections["Next Steps"]).map((title) => ({
        derivedFrom: "summary-file:Next Steps",
        itemType: "task",
        sessionId: ids.sessionId,
        sourceRefs,
        status: "planned",
        title
      })),
      notePath: path.posix.join(project.notePath, "active-tasks.md")
    }
  ];

  return plans
    .filter((plan) => plan.candidates.length > 0)
    .map((plan) => {
      const targetPath = vaultPathFor(runtime, plan.notePath);

      return {
        notePath: plan.notePath,
        result: updateMarkerBlock(readTrackedVaultMarkdown(runtime, plan.notePath, ErrorCode.MARKER_MISSING), plan.blockId, plan.candidates),
        targetPath
      };
    });
}

function buildProvenanceEntries(input: {
  readonly capturedAt: string;
  readonly sessionCard: string;
  readonly sessionId: string;
  readonly sessionNotePath: string;
  readonly sourceRef: string;
  readonly touchedItems: readonly TouchedGeneratedItem[];
}): ProvenanceEntry[] {
  return [
    {
      version: 1,
      event: "session-created",
      createdAt: input.capturedAt,
      sessionId: input.sessionId,
      sourceRefs: [input.sourceRef],
      derivedFrom: "summary-file",
      notePath: input.sessionNotePath,
      contentHash: hashContent(input.sessionCard)
    },
    ...input.touchedItems.map((item) => ({
      version: 1 as const,
      event: item.event,
      createdAt: input.capturedAt,
      sessionId: input.sessionId,
      itemId: item.id,
      itemType: item.itemType,
      sourceRefs: [...item.sourceRefs],
      derivedFrom: item.derivedFrom,
      notePath: markerNotePathFor(item.itemType, input.sessionNotePath),
      contentHash: hashContent(`${item.id}\n${item.title}\n${item.sourceRefs.join(",")}\n`)
    }))
  ];
}

function markerNotePathFor(itemType: TouchedGeneratedItem["itemType"], sessionNotePath: string): string {
  const projectNotePath = sessionNotePath.split("/04-sessions/")[0] ?? "";

  switch (itemType) {
    case "context-update":
      return path.posix.join(projectNotePath, "README.md");
    case "decision":
      return path.posix.join(projectNotePath, "decision-log.md");
    case "pitfall":
      return path.posix.join(projectNotePath, "pitfalls.md");
    case "task":
      return path.posix.join(projectNotePath, "active-tasks.md");
  }
}

function addSourceIndexEntry(input: {
  readonly capturedAt: string;
  readonly contentHash: string;
  readonly localPath: string;
  readonly sessionId: string;
  readonly sourceIndex: SourceIndex;
  readonly sourceRef: string;
  readonly tool: string;
  readonly visibility: CaptureVisibility;
}): SourceIndex {
  return {
    ...input.sourceIndex,
    sources: {
      ...input.sourceIndex.sources,
      [input.sourceRef]: {
        kind: "summary-file",
        tool: input.tool,
        capturedAt: input.capturedAt,
        sessionIds: [input.sessionId],
        localPath: input.localPath,
        contentHash: input.contentHash,
        privacy: input.visibility,
        rawIncluded: false,
        redacted: false
      }
    }
  };
}

function renderSessionCard(input: {
  readonly ids: CaptureIds;
  readonly route: CaptureRoute;
  readonly sections: SummarySections;
  readonly sessionNotePath: string;
  readonly sourceContentHash: string;
  readonly sourceRef: string;
  readonly tool: string;
  readonly touchedItems: readonly TouchedGeneratedItem[];
  readonly visibility: CaptureVisibility;
}): string {
  const title = sessionTitle(input.sections.Summary, input.ids.date);
  const decisions = input.touchedItems.filter((item) => item.itemType === "decision").map((item) => item.id);
  const tasks = input.touchedItems.filter((item) => item.itemType === "task").map((item) => item.id);
  const contextUpdates = input.touchedItems.filter((item) => item.itemType === "context-update").map((item) => item.id);
  const pitfalls = input.touchedItems.filter((item) => item.itemType === "pitfall").map((item) => item.id);
  const scope = writableScope(input.route.scope);
  const frontmatter: RenderSessionFrontmatter = {
    type: "agent-session",
    schemaVersion: 1,
    sessionId: input.ids.sessionId,
    notePath: input.sessionNotePath,
    title,
    date: input.ids.date,
    capturedAt: input.ids.capturedAt,
    agent: input.tool,
    tool: input.tool,
    ...(input.route.project === undefined
      ? {}
      : {
          projectId: input.route.project.id,
          project: input.route.project.name,
          repoId: input.route.project.repoId
        }),
    scope,
    status: input.sections.Handoff.trim() === "" ? "done" : "handoff",
    visibility: input.visibility,
    source: {
      kind: "summary-file",
      ref: input.sourceRef,
      rawIncluded: false
    },
    sourceRefs: [input.sourceRef],
    derivedItems: {
      decisions,
      tasks,
      contextUpdates,
      pitfalls
    },
    tags: ["session", input.route.scope, ...(input.route.project === undefined ? [] : [input.route.project.id])]
  };

  parseSessionFrontmatter(frontmatter);

  return [
    renderSessionFrontmatter(frontmatter),
    "",
    `# ${title}`,
    "",
    "## Summary",
    "",
    input.sections.Summary,
    "",
    "## Changes",
    "",
    input.sections.Changes || "- none",
    "",
    "## Decisions",
    "",
    input.sections.Decisions || "- none",
    "",
    "## Validation",
    "",
    input.sections.Validation || "- none",
    "",
    "## Next Steps",
    "",
    input.sections["Next Steps"] || "- none",
    "",
    "## Handoff",
    "",
    input.sections.Handoff || "- none",
    "",
    "## Source",
    "",
    `- sourceRef: ${input.sourceRef}`,
    "- sourceKind: summary-file",
    `- contentHash: ${input.sourceContentHash}`,
    ""
  ].join("\n");
}

function renderSessionFrontmatter(frontmatter: RenderSessionFrontmatter): string {
  const lines = [
    "---",
    "type: agent-session",
    "schemaVersion: 1",
    `sessionId: ${escapeYamlString(frontmatter.sessionId)}`,
    `notePath: ${escapeYamlString(frontmatter.notePath)}`,
    `title: ${escapeYamlString(frontmatter.title)}`,
    `date: ${escapeYamlString(frontmatter.date)}`,
    `capturedAt: ${escapeYamlString(frontmatter.capturedAt)}`,
    `agent: ${escapeYamlString(frontmatter.agent)}`,
    `tool: ${escapeYamlString(frontmatter.tool)}`
  ];

  if (frontmatter.projectId !== undefined && frontmatter.project !== undefined && frontmatter.repoId !== undefined) {
    lines.push(`projectId: ${escapeYamlString(frontmatter.projectId)}`);
    lines.push(`project: ${escapeYamlString(frontmatter.project)}`);
    lines.push(`repoId: ${escapeYamlString(frontmatter.repoId)}`);
  }

  lines.push(
    `scope: ${frontmatter.scope}`,
    `status: ${frontmatter.status}`,
    `visibility: ${frontmatter.visibility}`,
    "source:",
    `  kind: ${escapeYamlString(frontmatter.source.kind)}`,
    `  ref: ${escapeYamlString(frontmatter.source.ref)}`,
    "  rawIncluded: false",
    "sourceRefs:",
    ...frontmatter.sourceRefs.map((sourceRef) => `  - ${escapeYamlString(sourceRef)}`),
    "derivedItems:",
    "  decisions:",
    ...frontmatter.derivedItems.decisions.map((itemId) => `    - ${escapeYamlString(itemId)}`),
    "  tasks:",
    ...frontmatter.derivedItems.tasks.map((itemId) => `    - ${escapeYamlString(itemId)}`),
    "  contextUpdates:",
    ...frontmatter.derivedItems.contextUpdates.map((itemId) => `    - ${escapeYamlString(itemId)}`),
    "  pitfalls:",
    ...frontmatter.derivedItems.pitfalls.map((itemId) => `    - ${escapeYamlString(itemId)}`),
    "tags:",
    ...frontmatter.tags.map((tag) => `  - ${escapeYamlString(tag)}`),
    "---"
  );

  return lines.join("\n");
}

function createCaptureIds(input: {
  readonly now: Date;
  readonly provenanceLog: readonly ProvenanceEntry[];
  readonly sourceIndex: SourceIndex;
  readonly tool: string;
}): CaptureIds {
  const capturedAt = input.now.toISOString();
  const date = capturedAt.slice(0, 10);
  const dateStamp = date.replaceAll("-", "");
  const toolSlug = slugifyTool(input.tool);
  const sequence = nextCaptureSequence(dateStamp, toolSlug, input.sourceIndex, input.provenanceLog);

  return {
    capturedAt,
    date,
    dateStamp,
    sequence,
    sessionId: `SES-${dateStamp}-${String(sequence).padStart(3, "0")}`,
    sourceRef: `src_${dateStamp}_${toolSlug}_${String(sequence).padStart(3, "0")}`,
    toolSlug
  };
}

function writableScope(scope: CaptureScope): WritableCaptureScope {
  if (scope === "ignore") {
    throw new AgentNotesError(ErrorCode.INVALID_SCOPE, "ignore 不會建立 session card");
  }

  return scope;
}

function nextCaptureSequence(
  dateStamp: string,
  toolSlug: string,
  sourceIndex: SourceIndex,
  provenanceLog: readonly ProvenanceEntry[]
): number {
  const used = new Set<number>();
  const sourcePrefix = `src_${dateStamp}_${toolSlug}_`;
  const sessionPrefix = `SES-${dateStamp}-`;

  for (const sourceRef of Object.keys(sourceIndex.sources)) {
    if (sourceRef.startsWith(sourcePrefix)) {
      used.add(Number(sourceRef.slice(sourcePrefix.length)));
    }
  }

  for (const entry of provenanceLog) {
    if (entry.sessionId.startsWith(sessionPrefix)) {
      used.add(Number(entry.sessionId.slice(sessionPrefix.length)));
    }
  }

  for (let sequence = 1; ; sequence += 1) {
    if (!used.has(sequence)) {
      return sequence;
    }
  }
}

function sessionNotePathFor(route: CaptureRoute, ids: CaptureIds): string {
  const basename = `${ids.date}-${ids.sessionId.toLowerCase()}.md`;

  switch (route.scope) {
    case "project":
      if (route.project === undefined) {
        throw new AgentNotesError(ErrorCode.PROJECT_NOT_FOUND, "project route 缺少 project");
      }

      return path.posix.join(route.project.notePath, "04-sessions", basename);
    case "daily":
      return path.posix.join("02-Daily", basename);
    case "area":
      return path.posix.join("04-Areas", basename);
    case "personal":
      return path.posix.join("00-Meta", "Personal", basename);
    case "inbox":
      return path.posix.join("01-Inbox", basename);
    case "ignore":
      throw new AgentNotesError(ErrorCode.INVALID_SCOPE, "ignore 不會建立 session note");
  }
}

function formatCaptureResult(result: CaptureResult, dryRun: boolean): string {
  const lines = [
    dryRun ? "Agent Notes capture dry-run" : result.route.scope === "ignore" ? "Agent Notes capture ignored" : "Agent Notes capture complete",
    `scope: ${result.route.scope}`,
    `routing: ${result.route.reason}`,
    ...(result.sessionId === undefined ? [] : [`sessionId: ${result.sessionId}`]),
    ...(result.sourceRef === undefined ? [] : [`sourceRef: ${result.sourceRef}`]),
    ...(result.sessionNotePath === undefined ? [] : [`sessionNote: ${result.sessionNotePath}`]),
    `derivedItems: ${result.touchedItems.length}`,
    `filesToCreate: ${result.batch.plan.filesToCreate.map((filePath) => path.basename(filePath)).length}`,
    `filesToModify: ${result.batch.plan.filesToModify.map((filePath) => path.basename(filePath)).length}`,
    `filesToSkip: ${result.batch.plan.filesToSkip.map((filePath) => path.basename(filePath)).length}`,
    dryRun ? "no files written" : `written: ${result.result.written.length}`
  ];

  if (dryRun && result.batch.plan.filesToCreate.length + result.batch.plan.filesToModify.length > 0) {
    lines.push("plannedWrites:");

    for (const targetPath of [...result.batch.plan.filesToCreate, ...result.batch.plan.filesToModify]) {
      lines.push(`- ${safePlannedWriteLabel(targetPath, result.sessionNotePath)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function safePlannedWriteLabel(targetPath: string, sessionNotePath: string | undefined): string {
  if (sessionNotePath !== undefined && targetPath.endsWith(sessionNotePath.replaceAll("/", path.sep))) {
    return sessionNotePath;
  }

  return path.basename(targetPath);
}

function parseScope(value: string | undefined): CaptureScope | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (["area", "daily", "ignore", "inbox", "personal", "project"].includes(value)) {
    return value as CaptureScope;
  }

  throw new AgentNotesError(ErrorCode.INVALID_SCOPE, `不支援的 scope: ${value}`);
}

function parseVisibility(value: string): CaptureVisibility {
  if (["private", "public-safe", "team-safe"].includes(value)) {
    return value as CaptureVisibility;
  }

  throw new AgentNotesError(ErrorCode.CONFIG_INVALID, `不支援的 visibility: ${value}`);
}

function resolveExistingFile(input: string, context: CaptureContext, errorCode: ErrorCode): string {
  const targetPath = resolvePath(input, context);

  if (!existsSync(targetPath)) {
    throw new AgentNotesError(errorCode, "找不到指定檔案");
  }

  return targetPath;
}

function sessionTitle(summary: string, date: string): string {
  const title = firstSummaryItem(summary).replace(/^#+\s*/u, "").trim();

  return title === "" ? `Agent session ${date}` : title.slice(0, 120);
}

function slugifyTool(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "agent"
  );
}
