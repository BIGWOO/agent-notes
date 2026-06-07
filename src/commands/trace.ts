import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { readMarkerItems, type GeneratedItem } from "../core/markerBlocks.js";
import { parseSessionCard } from "../core/markdown.js";
import { type PathOptions } from "../core/paths.js";
import { loadProvenanceLog, loadSourceIndex } from "../core/provenanceStore.js";
import { loadAgentNotesRuntime, readTrackedVaultMarkdown, trackedMarkdownFiles, vaultRelativePath, type AgentNotesRuntime } from "../core/runtime.js";
import type { ProvenanceEntry, SourceIndex } from "../schemas/provenance.js";

interface TraceOptions {
  readonly json?: boolean;
}

export interface TraceContext extends PathOptions {
  readonly stdout?: (value: string) => void;
}

export interface TraceResult {
  readonly provenance: readonly ProvenanceEntry[];
  readonly sessions: readonly TraceSession[];
  readonly sourceRefs: readonly string[];
  readonly sources: readonly TraceSource[];
  readonly target: {
    readonly id: string;
    readonly type: "item" | "session" | "source";
  };
  readonly warnings: readonly string[];
}

interface TraceSession {
  readonly notePath?: string;
  readonly sessionId: string;
  readonly title?: string;
}

interface TraceSource {
  readonly contentHash?: string;
  readonly localSummary: string;
  readonly sourceRef: string;
  readonly tool: string;
}

interface SessionCardIndex {
  readonly notePath: string;
  readonly sessionId: string;
  readonly sourceRefs: readonly string[];
  readonly title?: string;
}

export function registerTraceCommand(program: Command): void {
  program
    .command("trace")
    .description("追溯 itemId、sessionId 或 sourceRef")
    .argument("<id>", "itemId、sessionId 或 sourceRef")
    .option("--json", "輸出 JSON")
    .action((id: string, options: TraceOptions) => {
      runTraceCommand(id, options);
    });
}

export function runTraceCommand(id: string, options: TraceOptions = {}, context: TraceContext = {}): TraceResult {
  const result = runTrace(id, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(options.json === true ? `${JSON.stringify(result, null, 2)}\n` : formatTraceResult(result));

  return result;
}

export function runTrace(id: string, context: TraceContext = {}): TraceResult {
  const runtime = loadAgentNotesRuntime(context);
  const sourceIndex = loadSourceIndex(runtime.vaultPath);
  const provenance = loadProvenanceLog(runtime.vaultPath);
  const sessionCards = readSessionCards(runtime);

  if (/^src_[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id)) {
    return traceSourceRef(id, runtime, sourceIndex, provenance, sessionCards);
  }

  if (/^SES-[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id)) {
    return traceSessionId(id, runtime, sourceIndex, provenance, sessionCards);
  }

  if (/^(DEC|TASK|CTX|PIT)-[0-9]{4,}$/u.test(id)) {
    return traceItemId(id, runtime, sourceIndex, provenance, sessionCards);
  }

  throw new AgentNotesError(ErrorCode.TRACE_TARGET_NOT_FOUND, "不支援的 trace target id");
}

function traceSourceRef(
  sourceRef: string,
  runtime: AgentNotesRuntime,
  sourceIndex: SourceIndex,
  provenance: readonly ProvenanceEntry[],
  sessionCards: readonly SessionCardIndex[]
): TraceResult {
  const source = sourceIndex.sources[sourceRef];

  if (source === undefined) {
    throw new AgentNotesError(ErrorCode.SOURCE_NOT_FOUND, `找不到 sourceRef: ${sourceRef}`);
  }

  const sourceSessions = new Set(source.sessionIds);
  const relatedProvenance = provenance.filter((entry) => entry.sourceRefs.includes(sourceRef));
  const sessions = mergeSessions(
    [...sourceSessions],
    sessionCards.filter((session) => session.sourceRefs.includes(sourceRef))
  );
  const warnings = source.localPath !== "" && !existsSync(source.localPath) ? ["local source missing"] : [];

  return {
    provenance: relatedProvenance,
    sessions,
    sourceRefs: [sourceRef],
    sources: [traceSourceFor(sourceRef, source)],
    target: {
      id: sourceRef,
      type: "source"
    },
    warnings
  };
}

function traceSessionId(
  sessionId: string,
  runtime: AgentNotesRuntime,
  sourceIndex: SourceIndex,
  provenance: readonly ProvenanceEntry[],
  sessionCards: readonly SessionCardIndex[]
): TraceResult {
  const relatedProvenance = provenance.filter((entry) => entry.sessionId === sessionId);
  const matchedCards = sessionCards.filter((session) => session.sessionId === sessionId);

  if (relatedProvenance.length === 0 && matchedCards.length === 0) {
    throw new AgentNotesError(ErrorCode.TRACE_TARGET_NOT_FOUND, `找不到 session: ${sessionId}`);
  }

  const sourceRefs = uniqueStrings([...matchedCards.flatMap((session) => session.sourceRefs), ...relatedProvenance.flatMap((entry) => entry.sourceRefs)]);

  ensureSourceRefsExist(sourceRefs, sourceIndex);

  return {
    provenance: relatedProvenance,
    sessions: mergeSessions([sessionId], matchedCards),
    sourceRefs,
    sources: sourceRefs.map((sourceRef) => traceSourceFor(sourceRef, sourceIndex.sources[sourceRef])),
    target: {
      id: sessionId,
      type: "session"
    },
    warnings: sourceWarnings(sourceRefs, sourceIndex)
  };
}

function traceItemId(
  itemId: string,
  runtime: AgentNotesRuntime,
  sourceIndex: SourceIndex,
  provenance: readonly ProvenanceEntry[],
  sessionCards: readonly SessionCardIndex[]
): TraceResult {
  const relatedProvenance = provenance.filter((entry) => entry.itemId === itemId);

  if (relatedProvenance.length === 0) {
    const trackedItem = readTrackedGeneratedItems(runtime).find((item) => item.id === itemId);

    if (trackedItem !== undefined) {
      throw new AgentNotesError(ErrorCode.PROVENANCE_ORPHAN, `item 存在但缺 provenance: ${itemId}`);
    }

    throw new AgentNotesError(ErrorCode.TRACE_TARGET_NOT_FOUND, `找不到 item: ${itemId}`);
  }

  const sourceRefs = uniqueStrings(relatedProvenance.flatMap((entry) => entry.sourceRefs));
  const sessionIds = uniqueStrings(relatedProvenance.map((entry) => entry.sessionId));

  ensureSourceRefsExist(sourceRefs, sourceIndex);

  const sessions = mergeSessions(
    sessionIds,
    sessionCards.filter((session) => sessionIds.includes(session.sessionId))
  );

  if (sessions.length === 0) {
    throw new AgentNotesError(ErrorCode.PROVENANCE_ORPHAN, `item 缺少 session chain: ${itemId}`);
  }

  return {
    provenance: relatedProvenance,
    sessions,
    sourceRefs,
    sources: sourceRefs.map((sourceRef) => traceSourceFor(sourceRef, sourceIndex.sources[sourceRef])),
    target: {
      id: itemId,
      type: "item"
    },
    warnings: sourceWarnings(sourceRefs, sourceIndex)
  };
}

function readSessionCards(runtime: AgentNotesRuntime): SessionCardIndex[] {
  return trackedMarkdownFiles(runtime)
    .map((targetPath) => {
      const parsed = parseSessionCard(readFileSync(targetPath, "utf8"));

      if (parsed?.sessionId === undefined) {
        return undefined;
      }

      return {
        notePath: vaultRelativePath(runtime, targetPath),
        sessionId: parsed.sessionId,
        sourceRefs: parsed.sourceRefs,
        ...(parsed.title === undefined ? {} : { title: parsed.title })
      };
    })
    .filter((session): session is SessionCardIndex => session !== undefined);
}

function readTrackedGeneratedItems(runtime: AgentNotesRuntime): GeneratedItem[] {
  return runtime.projectMap.projects.flatMap((project) =>
    [
      ["README.md", "project-summary"],
      ["active-tasks.md", "active-tasks"],
      ["decision-log.md", "decision-log"],
      ["pitfalls.md", "pitfalls"]
    ].flatMap(([fileName, blockId]) => {
      const notePath = path.posix.join(project.notePath, fileName ?? "");
      const targetPath = path.join(runtime.vaultPath, notePath);

      if (!existsSync(targetPath)) {
        return [];
      }

      const items = readMarkerItems(readTrackedVaultMarkdown(runtime, notePath), blockId ?? "");

      return Array.isArray(items) ? items : [];
    })
  );
}

function mergeSessions(sessionIds: readonly string[], cards: readonly SessionCardIndex[]): TraceSession[] {
  const byId = new Map<string, TraceSession>();

  for (const sessionId of sessionIds) {
    byId.set(sessionId, {
      sessionId
    });
  }

  for (const card of cards) {
    byId.set(card.sessionId, {
      notePath: card.notePath,
      sessionId: card.sessionId,
      ...(card.title === undefined ? {} : { title: card.title })
    });
  }

  return [...byId.values()];
}

function ensureSourceRefsExist(sourceRefs: readonly string[], sourceIndex: SourceIndex): void {
  const missing = sourceRefs.filter((sourceRef) => sourceIndex.sources[sourceRef] === undefined);

  if (missing.length > 0) {
    throw new AgentNotesError(ErrorCode.PROVENANCE_ORPHAN, `找不到 provenance sourceRef: ${missing.join(", ")}`);
  }
}

function traceSourceFor(sourceRef: string, source: SourceIndex["sources"][string] | undefined): TraceSource {
  if (source === undefined) {
    throw new AgentNotesError(ErrorCode.PROVENANCE_ORPHAN, `找不到 source: ${sourceRef}`);
  }

  return {
    ...(source.contentHash === undefined ? {} : { contentHash: source.contentHash }),
    localSummary: `${path.basename(source.localPath)}#${hashLabel(source.localPath)}`,
    sourceRef,
    tool: source.tool
  };
}

function sourceWarnings(sourceRefs: readonly string[], sourceIndex: SourceIndex): string[] {
  return sourceRefs.flatMap((sourceRef) => {
    const source = sourceIndex.sources[sourceRef];

    if (source === undefined || source.localPath === "" || existsSync(source.localPath)) {
      return [];
    }

    return [`local source missing: ${sourceRef}`];
  });
}

function formatTraceResult(result: TraceResult): string {
  const lines = [
    "Agent Notes trace",
    `target: ${result.target.type} ${result.target.id}`,
    "sessions:",
    ...formatSessions(result.sessions),
    "sourceRefs:",
    ...(result.sourceRefs.length === 0 ? ["- none"] : result.sourceRefs.map((sourceRef) => `- ${sourceRef}`)),
    "sources:",
    ...(result.sources.length === 0
      ? ["- none"]
      : result.sources.map((source) => `- ${source.sourceRef} | tool=${source.tool} | local=${source.localSummary}`)),
    "provenance:",
    ...(result.provenance.length === 0
      ? ["- none"]
      : result.provenance.map((entry) => `- ${entry.event} | ${entry.itemId ?? entry.sessionId} | ${entry.notePath} | derivedFrom=${entry.derivedFrom}`)),
    "warnings:",
    ...(result.warnings.length === 0 ? ["- none"] : result.warnings.map((warning) => `- ${warning}`))
  ];

  return `${lines.join("\n")}\n`;
}

function formatSessions(sessions: readonly TraceSession[]): string[] {
  if (sessions.length === 0) {
    return ["- none"];
  }

  return sessions.map((session) => `- ${session.sessionId}${session.notePath === undefined ? "" : ` | ${session.notePath}`}`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function hashLabel(value: string): string {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0").slice(0, 8);
}
