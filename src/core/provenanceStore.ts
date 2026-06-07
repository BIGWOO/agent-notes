import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { AgentNotesError, ErrorCode } from "./errors.js";
import { parseProvenanceEntry, parseSourceIndex, type ProvenanceEntry, type SourceIndex } from "../schemas/provenance.js";

export function sourceIndexPath(vaultPath: string): string {
  return path.join(vaultPath, ".agent-notes", "source-index.json");
}

export function provenanceLogPath(vaultPath: string): string {
  return path.join(vaultPath, ".agent-notes", "provenance.jsonl");
}

export function loadSourceIndex(vaultPath: string): SourceIndex {
  const targetPath = sourceIndexPath(vaultPath);

  if (!existsSync(targetPath)) {
    return {
      version: 1,
      sources: {}
    };
  }

  assertSafePrivateStorePath(vaultPath, targetPath);

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(targetPath, "utf8"));
  } catch {
    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "source-index.json 不是有效 JSON");
  }

  return parseSourceIndex(parsed);
}

export function loadProvenanceLog(vaultPath: string): ProvenanceEntry[] {
  const targetPath = provenanceLogPath(vaultPath);

  if (!existsSync(targetPath)) {
    return [];
  }

  assertSafePrivateStorePath(vaultPath, targetPath);

  return readFileSync(targetPath, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(line);
      } catch {
        throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "provenance.jsonl 含無效 JSON line");
      }

      return parseProvenanceEntry(parsed);
    });
}

function assertSafePrivateStorePath(vaultPath: string, targetPath: string): void {
  const realVaultPath = realpathSync.native(vaultPath);
  const parentPath = path.dirname(targetPath);
  const ancestors = ancestorPaths(vaultPath, parentPath);

  for (const ancestor of ancestors) {
    if (!existsSync(ancestor)) {
      continue;
    }

    const stats = lstatSync(ancestor);

    if (stats.isSymbolicLink()) {
      throw new AgentNotesError(ErrorCode.PATH_UNSAFE, ".agent-notes store parent 不可為 symlink");
    }

    const realAncestor = realpathSync.native(ancestor);
    const realRelative = path.relative(realVaultPath, realAncestor).replaceAll("\\", "/");

    if (realRelative.startsWith("../") || path.isAbsolute(realRelative)) {
      throw new AgentNotesError(ErrorCode.PATH_UNSAFE, ".agent-notes store parent 指向 vault 外");
    }
  }

  const stats = lstatSync(targetPath);

  if (stats.isSymbolicLink()) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, ".agent-notes store file 不可為 symlink");
  }

  const realTargetPath = realpathSync.native(targetPath);
  const realTargetRelative = path.relative(realVaultPath, realTargetPath).replaceAll("\\", "/");

  if (realTargetRelative.startsWith("../") || path.isAbsolute(realTargetRelative)) {
    throw new AgentNotesError(ErrorCode.PATH_UNSAFE, ".agent-notes store file 指向 vault 外");
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

export function renderSourceIndex(sourceIndex: SourceIndex): string {
  return `${JSON.stringify(sourceIndex, null, 2)}\n`;
}

export function renderProvenanceLog(entries: readonly ProvenanceEntry[]): string {
  return entries.length === 0 ? "" : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function appendProvenanceEntries(existing: readonly ProvenanceEntry[], nextEntries: readonly ProvenanceEntry[]): string {
  return renderProvenanceLog([...existing, ...nextEntries]);
}
