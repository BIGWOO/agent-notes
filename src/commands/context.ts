import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { readMarkerItems, type GeneratedItem } from "../core/markerBlocks.js";
import { parseSessionCard } from "../core/markdown.js";
import { type PathOptions } from "../core/paths.js";
import { findProjectByRepoPath, loadAgentNotesRuntime, readTrackedVaultMarkdown } from "../core/runtime.js";
import type { ProjectMapEntry } from "../schemas/projectMap.js";
import { resolveRepoRoot, summarizeRepo, type RepoSummary } from "./project.js";

interface ContextOptions {
  readonly maxChars?: string;
  readonly repo?: string;
}

export interface ContextCommandContext extends PathOptions {
  readonly stdout?: (value: string) => void;
}

export interface ContextResult {
  readonly maxChars: number;
  readonly output: string;
  readonly project: ProjectMapEntry;
  readonly repoSummary: RepoSummary;
}

interface RecentSession {
  readonly capturedAt: string;
  readonly notePath: string;
  readonly sessionId: string;
  readonly sourceRefs: readonly string[];
  readonly title: string;
}

interface ContextPacketModel {
  readonly activeTasks: readonly GeneratedItem[] | "invalid" | "missing";
  readonly decisions: readonly GeneratedItem[] | "invalid" | "missing";
  readonly omitted: {
    activeTasks: number;
    pitfalls: number;
    recentSessions: number;
  };
  readonly pitfalls: readonly GeneratedItem[] | "invalid" | "missing";
  readonly project: ProjectMapEntry;
  readonly recentSessions: readonly RecentSession[];
  readonly summary: readonly GeneratedItem[] | "invalid" | "missing";
}

export function registerContextCommand(program: Command): void {
  program
    .command("context")
    .description("輸出 bounded project context packet")
    .requiredOption("--repo <path>", "repo 路徑")
    .option("--max-chars <count>", "輸出字元上限")
    .action((options: ContextOptions) => {
      runContextCommand(options);
    });
}

export function runContextCommand(options: ContextOptions, context: ContextCommandContext = {}): ContextResult {
  const result = runContext(options, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(result.output);

  return result;
}

export function runContext(options: ContextOptions, context: ContextCommandContext = {}): ContextResult {
  if (options.repo === undefined || options.repo.trim() === "") {
    throw new AgentNotesError(ErrorCode.PATH_INVALID, "context 需要 --repo");
  }

  const runtime = loadAgentNotesRuntime(context);
  const repoPath = resolveRepoRoot(options.repo, context);
  const project = findProjectByRepoPath(runtime.projectMap, repoPath);

  if (project === undefined) {
    throw new AgentNotesError(ErrorCode.PROJECT_NOT_FOUND, 'repo 尚未加入 project map，請執行 agent-notes project add --repo "$PWD"');
  }

  const maxChars = parseMaxChars(options.maxChars);
  const model = boundContextModel(
    {
      activeTasks: readProjectMarkerItems(runtime.vaultPath, project, "active-tasks.md", "active-tasks"),
      decisions: readProjectMarkerItems(runtime.vaultPath, project, "decision-log.md", "decision-log"),
      omitted: {
        activeTasks: 0,
        pitfalls: 0,
        recentSessions: 0
      },
      pitfalls: readProjectMarkerItems(runtime.vaultPath, project, "pitfalls.md", "pitfalls"),
      project,
      recentSessions: readRecentProjectSessions(runtime.vaultPath, project).slice(0, 5),
      summary: readProjectMarkerItems(runtime.vaultPath, project, "README.md", "project-summary")
    },
    maxChars
  );
  const output = renderContextPacket(model, maxChars);

  return {
    maxChars,
    output,
    project,
    repoSummary: summarizeRepo(repoPath)
  };
}

function boundContextModel(model: ContextPacketModel, maxChars: number): ContextPacketModel {
  let nextModel = model;

  for (const section of ["recentSessions", "pitfalls", "activeTasks"] as const) {
    while (renderContextPacket(nextModel, maxChars).length > maxChars) {
      const current = nextModel[section];

      if (!Array.isArray(current) || current.length === 0) {
        break;
      }

      nextModel = {
        ...nextModel,
        [section]: current.slice(0, -1),
        omitted: {
          ...nextModel.omitted,
          [section]: nextModel.omitted[section] + 1
        }
      };
    }
  }

  return nextModel;
}

function renderContextPacket(model: ContextPacketModel, maxChars: number): string {
  const lines = [
    "# Agent Notes Context",
    "",
    "## Project",
    `- projectId: ${model.project.id}`,
    `- name: ${model.project.name}`,
    `- notePath: ${model.project.notePath}`,
    "",
    "## Project Summary",
    ...renderGeneratedSection(latestSummaryItem(model.summary), 0),
    "",
    "## Active Tasks",
    ...renderGeneratedSection(model.activeTasks, model.omitted.activeTasks),
    "",
    "## Recent Decisions",
    ...renderGeneratedSection(model.decisions, 0),
    "",
    "## Pitfalls",
    ...renderGeneratedSection(model.pitfalls, model.omitted.pitfalls),
    "",
    "## Recent Sessions",
    ...renderRecentSessions(model.recentSessions, model.omitted.recentSessions),
    "",
    "## Trace Hints",
    ...renderTraceHints(model),
    ""
  ];
  const rendered = lines.join("\n");

  if (rendered.length <= maxChars) {
    return rendered;
  }

  return `${rendered.slice(0, Math.max(0, maxChars - 34)).trimEnd()}\n- omitted: packet truncated\n`;
}

function readProjectMarkerItems(
  vaultPath: string,
  project: ProjectMapEntry,
  fileName: string,
  blockId: string
): readonly GeneratedItem[] | "invalid" | "missing" {
  const targetPath = path.join(vaultPath, project.notePath, fileName);

  if (!existsSync(targetPath)) {
    return "missing";
  }

  return readMarkerItems(readTrackedVaultMarkdown({ vaultPath }, path.posix.join(project.notePath, fileName), ErrorCode.MARKER_MISSING), blockId);
}

function readRecentProjectSessions(vaultPath: string, project: ProjectMapEntry): RecentSession[] {
  const sessionsDirectory = path.join(vaultPath, project.notePath, "04-sessions");

  if (!existsSync(sessionsDirectory)) {
    return [];
  }

  return readdirSync(sessionsDirectory)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => {
      const notePath = path.posix.join(project.notePath, "04-sessions", fileName);
      const targetPath = path.join(vaultPath, notePath);

      if (lstatSync(targetPath).isSymbolicLink()) {
        return undefined;
      }

      const parsed = parseSessionCard(readTrackedVaultMarkdown({ vaultPath }, notePath));

      return parsed === undefined || parsed.capturedAt === undefined || parsed.sessionId === undefined
        ? undefined
        : {
            capturedAt: parsed.capturedAt,
            notePath,
            sessionId: parsed.sessionId,
            sourceRefs: parsed.sourceRefs,
            title: parsed.title ?? parsed.sessionId
          };
    })
    .filter((session): session is RecentSession => session !== undefined)
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
}

function renderGeneratedSection(items: readonly GeneratedItem[] | "invalid" | "missing", omittedCount: number): string[] {
  if (items === "missing") {
    return ["- unavailable: marker missing"];
  }

  if (items === "invalid") {
    return ["- unavailable: marker invalid"];
  }

  if (items.length === 0 && omittedCount === 0) {
    return ["- none"];
  }

  return [
    ...items.flatMap(renderGeneratedItem),
    ...(omittedCount === 0 ? [] : [`- omitted: ${omittedCount} items due to max-chars`])
  ];
}

function latestSummaryItem(items: readonly GeneratedItem[] | "invalid" | "missing"): readonly GeneratedItem[] | "invalid" | "missing" {
  if (!Array.isArray(items)) {
    return items;
  }

  const summaryItems = items.filter((item) => item.id.startsWith("CTX-"));

  return summaryItems.length === 0 ? [] : [summaryItems[summaryItems.length - 1] as GeneratedItem];
}

function renderGeneratedItem(item: GeneratedItem): string[] {
  return [
    `- ${item.id} | ${item.title}`,
    ...(item.status === undefined ? [] : [`  - status: ${item.status}`]),
    ...(item.sessionId === undefined ? [] : [`  - session: ${item.sessionId}`]),
    `  - sourceRefs: ${item.sourceRefs.join(", ") || "none"}`
  ];
}

function renderRecentSessions(sessions: readonly RecentSession[], omittedCount: number): string[] {
  if (sessions.length === 0 && omittedCount === 0) {
    return ["- none"];
  }

  return [
    ...sessions.flatMap((session) => [
      `- ${session.sessionId} | ${session.title}`,
      `  - notePath: ${session.notePath}`,
      `  - sourceRefs: ${session.sourceRefs.join(", ") || "none"}`
    ]),
    ...(omittedCount === 0 ? [] : [`- omitted: ${omittedCount} items due to max-chars`])
  ];
}

function renderTraceHints(model: ContextPacketModel): string[] {
  const itemIds = new Set<string>();
  const sourceRefs = new Set<string>();

  for (const section of [model.summary, model.activeTasks, model.decisions, model.pitfalls]) {
    if (!Array.isArray(section)) {
      continue;
    }

    for (const item of section) {
      itemIds.add(item.id);

      for (const sourceRef of item.sourceRefs) {
        sourceRefs.add(sourceRef);
      }
    }
  }

  for (const session of model.recentSessions) {
    itemIds.add(session.sessionId);

    for (const sourceRef of session.sourceRefs) {
      sourceRefs.add(sourceRef);
    }
  }

  const hints = [...itemIds, ...sourceRefs].slice(0, 8).map((id) => `- agent-notes trace ${id}`);

  return hints.length === 0 ? ["- none"] : hints;
}

function parseMaxChars(value: string | undefined): number {
  if (value === undefined) {
    return 12000;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1000) {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "--max-chars 必須是大於等於 1000 的整數");
  }

  return parsed;
}
