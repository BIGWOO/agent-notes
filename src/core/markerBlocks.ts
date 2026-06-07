import { AgentNotesError, ErrorCode } from "./errors.js";
import { normalizeGeneratedTitle } from "./markdown.js";

export type GeneratedItemType = "context-update" | "decision" | "task" | "pitfall";

export interface GeneratedItem {
  readonly id: string;
  readonly itemType: GeneratedItemType;
  readonly rawLines: readonly string[];
  readonly sessionId?: string;
  readonly sourceRefs: readonly string[];
  readonly status?: string;
  readonly title: string;
}

export interface CandidateGeneratedItem {
  readonly derivedFrom: string;
  readonly itemType: GeneratedItemType;
  readonly sessionId: string;
  readonly sourceRefs: readonly string[];
  readonly status?: string;
  readonly title: string;
}

export interface TouchedGeneratedItem extends GeneratedItem {
  readonly derivedFrom: string;
  readonly event: "derived-item-created" | "derived-item-updated";
}

export interface MarkerUpdateResult {
  readonly content: string;
  readonly changed: boolean;
  readonly touchedItems: readonly TouchedGeneratedItem[];
}

interface MarkerBlock {
  readonly blockId: string;
  readonly endLine: number;
  readonly innerLines: readonly string[];
  readonly startLine: number;
}

const startMarkerPattern = /^<!-- agent-notes:start ([a-z0-9-]+) -->$/u;
const endMarkerPattern = /^<!-- agent-notes:end ([a-z0-9-]+) -->$/u;
const conflictMarkerPattern = /^(?:<<<<<<<|=======|>>>>>>>)($|\s)/u;

export function updateMarkerBlock(
  content: string,
  blockId: string,
  candidates: readonly CandidateGeneratedItem[]
): MarkerUpdateResult {
  if (candidates.length === 0) {
    return {
      content,
      changed: false,
      touchedItems: []
    };
  }

  const normalized = normalizeMarkdown(content);
  const lines = normalized.split("\n");
  const blocks = parseMarkerBlocks(normalized);
  const block = blocks.get(blockId);

  if (block === undefined) {
    throw new AgentNotesError(ErrorCode.MARKER_MISSING, `找不到 marker block: ${blockId}`);
  }

  for (const candidate of candidates) {
    if (candidate.sourceRefs.length === 0) {
      throw new AgentNotesError(ErrorCode.PROVENANCE_ORPHAN, "generated item 缺少 sourceRefs");
    }
  }

  const existingItems = parseGeneratedItems(block.innerLines.join("\n"));
  const orphanItem = existingItems.find((item) => item.sourceRefs.length === 0);

  if (orphanItem !== undefined) {
    throw new AgentNotesError(ErrorCode.PROVENANCE_ORPHAN, `generated item 缺少 sourceRefs: ${orphanItem.id}`);
  }

  const existingByFingerprint = new Map(existingItems.map((item) => [fingerprintFor(item.itemType, item.title), item]));
  const usedIds = new Set(existingItems.map((item) => item.id));
  const nextItems = [...existingItems];
  const touchedItems: TouchedGeneratedItem[] = [];

  for (const candidate of candidates) {
    const fingerprint = fingerprintFor(candidate.itemType, candidate.title);
    const existing = existingByFingerprint.get(fingerprint);

    if (existing === undefined) {
      const created: GeneratedItem = {
        id: nextItemId(candidate.itemType, usedIds),
        itemType: candidate.itemType,
        rawLines: [],
        sessionId: candidate.sessionId,
        sourceRefs: uniqueStrings(candidate.sourceRefs),
        ...(candidate.status === undefined ? {} : { status: candidate.status }),
        title: candidate.title
      };

      usedIds.add(created.id);
      existingByFingerprint.set(fingerprint, created);
      nextItems.push(created);
      touchedItems.push({
        ...created,
        derivedFrom: candidate.derivedFrom,
        event: "derived-item-created"
      });
      continue;
    }

    const mergedSourceRefs = uniqueStrings([...existing.sourceRefs, ...candidate.sourceRefs]);
    const sourceRefsChanged = mergedSourceRefs.length !== existing.sourceRefs.length;
    const sessionChanged = existing.sessionId !== candidate.sessionId;

    if (!sourceRefsChanged && !sessionChanged) {
      continue;
    }

    const updated: GeneratedItem = {
      ...existing,
      sessionId: candidate.sessionId,
      sourceRefs: mergedSourceRefs,
      ...(candidate.status === undefined ? {} : { status: candidate.status })
    };
    const itemIndex = nextItems.findIndex((item) => item.id === existing.id);

    nextItems[itemIndex] = updated;
    existingByFingerprint.set(fingerprint, updated);
    touchedItems.push({
      ...updated,
      derivedFrom: candidate.derivedFrom,
      event: "derived-item-updated"
    });
  }

  const replacementLines = renderGeneratedItems(nextItems);
  const updatedLines = [
    ...lines.slice(0, block.startLine + 1),
    ...replacementLines,
    ...lines.slice(block.endLine)
  ];
  const nextContent = ensureTrailingNewline(updatedLines.join("\n"));

  return {
    content: nextContent,
    changed: nextContent !== content,
    touchedItems
  };
}

export function readMarkerItems(content: string, blockId: string): readonly GeneratedItem[] | "missing" | "invalid" {
  try {
    const block = parseMarkerBlocks(content).get(blockId);

    return block === undefined ? "missing" : parseGeneratedItems(block.innerLines.join("\n"));
  } catch {
    return "invalid";
  }
}

export function validateMarkerContent(content: string, requiredBlockIds: readonly string[]): void {
  const blocks = parseMarkerBlocks(content);

  for (const blockId of requiredBlockIds) {
    if (!blocks.has(blockId)) {
      throw new AgentNotesError(ErrorCode.MARKER_MISSING, `找不到 marker block: ${blockId}`);
    }
  }

  for (const blockId of requiredBlockIds) {
    const block = blocks.get(blockId);

    if (block === undefined) {
      continue;
    }

    for (const item of parseGeneratedItems(block.innerLines.join("\n"))) {
      if (item.sourceRefs.length === 0) {
        throw new AgentNotesError(ErrorCode.PROVENANCE_ORPHAN, `generated item 缺少 sourceRefs: ${item.id}`);
      }
    }
  }
}

function parseMarkerBlocks(content: string): Map<string, MarkerBlock> {
  const normalized = normalizeMarkdown(content);
  const lines = normalized.split("\n");
  const blocks = new Map<string, MarkerBlock>();
  let open:
    | {
        readonly blockId: string;
        readonly startLine: number;
      }
    | undefined;

  for (const [lineIndex, line] of lines.entries()) {
    if (conflictMarkerPattern.test(line)) {
      throw new AgentNotesError(ErrorCode.WRITE_CONFLICT, "marker target 含未解決 conflict marker");
    }

    const startMatch = startMarkerPattern.exec(line.trim());

    if (startMatch !== null) {
      if (open !== undefined) {
        throw new AgentNotesError(ErrorCode.MARKER_INVALID, "marker block 不支援巢狀結構");
      }

      const blockId = startMatch[1] ?? "";

      if (blocks.has(blockId)) {
        throw new AgentNotesError(ErrorCode.MARKER_INVALID, `marker block 重複: ${blockId}`);
      }

      open = {
        blockId,
        startLine: lineIndex
      };
      continue;
    }

    const endMatch = endMarkerPattern.exec(line.trim());

    if (endMatch === null) {
      continue;
    }

    if (open === undefined) {
      throw new AgentNotesError(ErrorCode.MARKER_INVALID, "marker end 缺少對應 start");
    }

    const endBlockId = endMatch[1] ?? "";

    if (endBlockId !== open.blockId) {
      throw new AgentNotesError(ErrorCode.MARKER_INVALID, "marker start/end id 不一致");
    }

    blocks.set(open.blockId, {
      blockId: open.blockId,
      endLine: lineIndex,
      innerLines: lines.slice(open.startLine + 1, lineIndex),
      startLine: open.startLine
    });
    open = undefined;
  }

  if (open !== undefined) {
    throw new AgentNotesError(ErrorCode.MARKER_INVALID, "marker start 缺少對應 end");
  }

  return blocks;
}

function parseGeneratedItems(content: string): GeneratedItem[] {
  const lines = normalizeMarkdown(content).split("\n");
  const items: GeneratedItem[] = [];
  let current:
    | {
        id: string;
        itemType: GeneratedItemType;
        lines: string[];
        metadata: Map<string, string>;
        title: string;
      }
    | undefined;

  const flush = (): void => {
    if (current === undefined) {
      return;
    }

    const sessionId = current.metadata.get("session");
    const sourceRefs = splitRefs(current.metadata.get("sourceRefs") ?? "");
    const status = current.metadata.get("status");

    items.push({
      id: current.id,
      itemType: current.itemType,
      rawLines: current.lines,
      ...(sessionId === undefined ? {} : { sessionId }),
      sourceRefs,
      ...(status === undefined ? {} : { status }),
      title: current.title
    });
    current = undefined;
  };

  for (const line of lines) {
    const itemMatch = /^- (DEC|TASK|CTX|PIT)-(\d{4,}) \| (.+)$/u.exec(line);

    if (itemMatch !== null) {
      flush();

      const prefix = itemMatch[1] ?? "";
      const numericId = itemMatch[2] ?? "";
      const title = itemMatch[3] ?? "";

      current = {
        id: `${prefix}-${numericId}`,
        itemType: itemTypeForPrefix(prefix),
        lines: [line],
        metadata: new Map<string, string>(),
        title: title.trim()
      };
      continue;
    }

    if (current === undefined) {
      if (line.trim() === "") {
        continue;
      }

      throw new AgentNotesError(ErrorCode.MARKER_INVALID, "generated block 含無法解析的內容");
    }

    current.lines.push(line);

    const metadataMatch = /^ {2}- ([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line);

    if (metadataMatch !== null) {
      current.metadata.set(metadataMatch[1] ?? "", (metadataMatch[2] ?? "").trim());
    }
  }

  flush();

  return items;
}

function renderGeneratedItems(items: readonly GeneratedItem[]): string[] {
  return items.flatMap((item) => (item.rawLines.length > 0 ? patchExistingGeneratedItem(item) : renderNewGeneratedItem(item)));
}

function renderNewGeneratedItem(item: GeneratedItem): string[] {
  const lines = [`- ${item.id} | ${item.title}`];

  if (item.status !== undefined) {
    lines.push(`  - status: ${item.status}`);
  }

  if (item.sessionId !== undefined) {
    lines.push(`  - session: ${item.sessionId}`);
  }

  lines.push(`  - sourceRefs: ${item.sourceRefs.join(", ")}`);

  return lines;
}

function patchExistingGeneratedItem(item: GeneratedItem): string[] {
  const lines = [...item.rawLines];
  const setManagedLine = (key: "session" | "sourceRefs" | "status", value: string | undefined): void => {
    if (value === undefined) {
      return;
    }

    const nextLine = `  - ${key}: ${value}`;
    const lineIndex = lines.findIndex((line) => new RegExp(`^ {2}- ${key}:`, "u").test(line));

    if (lineIndex === -1) {
      lines.splice(insertionIndexForManagedMetadata(lines), 0, nextLine);
      return;
    }

    lines[lineIndex] = nextLine;
  };

  lines[0] = `- ${item.id} | ${item.title}`;
  setManagedLine("status", item.status);
  setManagedLine("session", item.sessionId);
  setManagedLine("sourceRefs", item.sourceRefs.join(", "));

  return lines;
}

function insertionIndexForManagedMetadata(lines: readonly string[]): number {
  let index = 1;

  while (index < lines.length && /^ {2}- [A-Za-z][A-Za-z0-9_-]*:/u.test(lines[index] ?? "")) {
    index += 1;
  }

  return index;
}

function nextItemId(itemType: GeneratedItemType, usedIds: Set<string>): string {
  const prefix = prefixForItemType(itemType);

  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}-${String(index).padStart(4, "0")}`;

    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
}

function fingerprintFor(itemType: GeneratedItemType, title: string): string {
  return `${itemType}:${normalizeGeneratedTitle(title)}`;
}

function itemTypeForPrefix(prefix: string): GeneratedItemType {
  switch (prefix) {
    case "DEC":
      return "decision";
    case "TASK":
      return "task";
    case "CTX":
      return "context-update";
    case "PIT":
      return "pitfall";
    default:
      throw new AgentNotesError(ErrorCode.MARKER_INVALID, `未知 item prefix: ${prefix}`);
  }
}

function prefixForItemType(itemType: GeneratedItemType): "CTX" | "DEC" | "PIT" | "TASK" {
  switch (itemType) {
    case "context-update":
      return "CTX";
    case "decision":
      return "DEC";
    case "pitfall":
      return "PIT";
    case "task":
      return "TASK";
  }
}

function splitRefs(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

function normalizeMarkdown(content: string): string {
  return content.replace(/\r\n?/gu, "\n");
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
