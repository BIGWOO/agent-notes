import { AgentNotesError, ErrorCode } from "./errors.js";

export const summarySectionNames = ["Summary", "Changes", "Decisions", "Validation", "Next Steps", "Handoff"] as const;

export type SummarySectionName = (typeof summarySectionNames)[number];

export type SummarySections = Record<SummarySectionName, string>;

export interface ParsedSummaryFile {
  readonly sections: SummarySections;
}

export interface ParsedSessionCard {
  readonly capturedAt?: string;
  readonly notePath?: string;
  readonly sessionId?: string;
  readonly sourceRefs: readonly string[];
  readonly title?: string;
}

export function parseSummaryFile(content: string): ParsedSummaryFile {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const sections = Object.fromEntries(summarySectionNames.map((name) => [name, ""])) as SummarySections;
  const headingPositions: {
    readonly name: SummarySectionName;
    readonly lineIndex: number;
  }[] = [];
  let openFence: MarkdownFence | undefined;

  for (const [lineIndex, line] of lines.entries()) {
    const nextFence = nextFenceState(openFence, line);

    if (nextFence !== openFence) {
      openFence = nextFence;

      continue;
    }

    if (openFence !== undefined) {
      continue;
    }

    const headingMatch = /^## ([A-Za-z ]+)$/u.exec(line.trim());

    if (headingMatch === null) {
      continue;
    }

    const name = headingMatch[1] as SummarySectionName;

    if (summarySectionNames.includes(name)) {
      headingPositions.push({
        name,
        lineIndex
      });
    }
  }

  if (headingPositions.length !== summarySectionNames.length) {
    throw new AgentNotesError(ErrorCode.INVALID_SUMMARY_FILE, "summary file 必須包含固定 headings");
  }

  for (const [index, expectedName] of summarySectionNames.entries()) {
    if (headingPositions[index]?.name !== expectedName) {
      throw new AgentNotesError(ErrorCode.INVALID_SUMMARY_FILE, "summary file headings 必須依固定順序排列");
    }
  }

  for (const [index, heading] of headingPositions.entries()) {
    const nextHeading = headingPositions[index + 1];
    const sectionLines = lines.slice(heading.lineIndex + 1, nextHeading?.lineIndex ?? lines.length);

    sections[heading.name] = trimSection(sectionLines.join("\n"));
  }

  if (sections.Summary.trim() === "") {
    throw new AgentNotesError(ErrorCode.INVALID_SUMMARY_FILE, "summary file 的 Summary 必須有內容");
  }

  return {
    sections
  };
}

export function extractSectionListItems(sectionContent: string): string[] {
  const items: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    const title = stripTrailingMarkdownComment(paragraph.join(" ").trim());

    if (isUsableGeneratedTitle(title)) {
      items.push(title);
    }

    paragraph = [];
  };

  for (const line of linesOutsideFences(sectionContent)) {
    const bulletMatch = /^(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/u.exec(line.trimEnd());

    if (bulletMatch !== null && !line.startsWith(" ") && !line.startsWith("\t")) {
      flushParagraph();

      const title = stripTrailingMarkdownComment(bulletMatch[1]?.trim() ?? "");

      if (isUsableGeneratedTitle(title)) {
        items.push(title);
      }

      continue;
    }

    if (line.trim() === "" || /^\s+(?:[-*]|\d+\.)\s+/u.test(line)) {
      flushParagraph();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();

  return items;
}

export function firstSummaryItem(summaryContent: string): string {
  const listItems = extractSectionListItems(summaryContent);

  if (listItems.length > 0) {
    return listItems[0] ?? "";
  }

  return (
    linesOutsideFences(summaryContent)
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("#")) ?? ""
  );
}

export function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

export function extractFrontmatter(content: string): string | undefined {
  const normalized = content.replace(/\r\n?/gu, "\n");

  if (!normalized.startsWith("---\n")) {
    return undefined;
  }

  const endIndex = normalized.indexOf("\n---\n", 4);

  return endIndex === -1 ? undefined : normalized.slice(4, endIndex);
}

export function parseSessionCard(content: string): ParsedSessionCard | undefined {
  const frontmatter = extractFrontmatter(content);

  if (frontmatter === undefined) {
    return undefined;
  }

  const capturedAt = scalarFrontmatterValue(frontmatter, "capturedAt");
  const notePath = scalarFrontmatterValue(frontmatter, "notePath");
  const sessionId = scalarFrontmatterValue(frontmatter, "sessionId");
  const title = scalarFrontmatterValue(frontmatter, "title");

  return {
    ...(capturedAt === undefined ? {} : { capturedAt }),
    ...(notePath === undefined ? {} : { notePath }),
    ...(sessionId === undefined ? {} : { sessionId }),
    sourceRefs: arrayFrontmatterValue(frontmatter, "sourceRefs"),
    ...(title === undefined ? {} : { title })
  };
}

export function normalizeGeneratedTitle(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function scalarFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "mu").exec(frontmatter);
  const value = match?.[1];

  return value === undefined ? undefined : stripYamlQuotes(value);
}

function arrayFrontmatterValue(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split(/\r?\n/u);
  const values: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== `${key}:`) {
      continue;
    }

    for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
      const line = lines[childIndex] ?? "";
      const match = /^ {2}- (.+)$/u.exec(line);

      if (match === null) {
        break;
      }

      values.push(stripYamlQuotes(match[1] ?? ""));
    }
  }

  return values;
}

function trimSection(value: string): string {
  return value.replace(/^\n+/u, "").replace(/\n+$/u, "");
}

function linesOutsideFences(content: string): string[] {
  const lines: string[] = [];
  let openFence: MarkdownFence | undefined;

  for (const line of content.split(/\r?\n/u)) {
    const nextFence = nextFenceState(openFence, line);

    if (nextFence !== openFence) {
      openFence = nextFence;

      continue;
    }

    if (openFence === undefined) {
      lines.push(line);
    }
  }

  return lines;
}

interface MarkdownFence {
  readonly char: string;
  readonly length: number;
}

function nextFenceState(openFence: MarkdownFence | undefined, line: string): MarkdownFence | undefined {
  if (openFence !== undefined) {
    const closingMatch = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
    const marker = closingMatch?.[1] ?? "";
    const char = marker.slice(0, 1);

    return char === openFence.char && marker.length >= openFence.length ? undefined : openFence;
  }

  const openingMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  const marker = openingMatch?.[1];

  if (marker === undefined) {
    return undefined;
  }

  return {
    char: marker.slice(0, 1),
    length: marker.length
  };
}

function stripTrailingMarkdownComment(value: string): string {
  return value.replace(/\s+<!--.*-->$/u, "").trim();
}

function isUsableGeneratedTitle(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /[\p{L}\p{N}]/u.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
