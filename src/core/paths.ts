import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface PathOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

export interface CanonicalPathOptions extends PathOptions {
  readonly mustExist?: boolean;
}

export function expandPath(input: string, options: PathOptions = {}): string {
  const homeDir = options.homeDir ?? options.env?.HOME ?? homedir();

  if (input === "~") {
    return homeDir;
  }

  if (input.startsWith("~/")) {
    return path.join(homeDir, input.slice(2));
  }

  return input.replaceAll("${HOME}", homeDir).replaceAll("$HOME", homeDir);
}

export function resolvePath(input: string, options: PathOptions = {}): string {
  const expanded = expandPath(input, options);

  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }

  return path.resolve(options.cwd ?? process.cwd(), expanded);
}

export function canonicalizePath(input: string, options: CanonicalPathOptions = {}): string {
  const resolved = resolvePath(input, options);

  if (options.mustExist === true || existsSync(resolved)) {
    return realpathSync.native(resolved);
  }

  return resolved;
}

export function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

export function isVaultRelativePath(value: string): boolean {
  if (value.trim() === "" || value.includes("\0")) {
    return false;
  }

  if (value.startsWith("~") || value.startsWith("$HOME") || value.startsWith("${HOME}")) {
    return false;
  }

  if (isAbsolutePath(value)) {
    return false;
  }

  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));

  return normalized !== "." && !normalized.startsWith("../") && normalized !== "..";
}
