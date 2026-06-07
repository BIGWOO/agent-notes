import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { AgentNotesError, ErrorCode } from "./errors.js";
import { resolvePath, type PathOptions } from "./paths.js";

export type IntegrationAgent = "codex" | "claude-code" | "openclaw";
export type IntegrationStatusValue = "supported" | "not-found" | "unsupported" | "coming-soon" | "dry-run-only";
export type IntegrationMode = "dry-run" | "applied";

export interface IntegrationStatus {
  readonly agent: IntegrationAgent;
  readonly status: IntegrationStatusValue;
  readonly message: string;
}

export interface IntegrationContext extends PathOptions {
  readonly operationId?: string;
  readonly stdout?: (value: string) => void;
}

export interface IntegrationDryRunResult {
  readonly agent: IntegrationAgent;
  readonly mode: "dry-run";
  readonly detectionSummary: string;
  readonly hookCommand: string;
  readonly stableBinary: string;
  readonly filesToModify: number;
  readonly filesToBackup: number;
  readonly hints: readonly string[];
}

export function stableBinaryFor(binaryInput: string | undefined, mode: IntegrationMode): string {
  const binary = binaryInput?.trim() || "agent-notes";
  const hasExplicitBinary = binaryInput !== undefined && binaryInput.trim() !== "";
  const hasPathSeparator = binary.includes("/") || binary.includes("\\");

  if (
    binary === "" ||
    binary.includes("\0") ||
    (mode === "applied" && (!hasExplicitBinary || !path.isAbsolute(binary))) ||
    (hasPathSeparator && !path.isAbsolute(binary)) ||
    isEphemeralBinary(binary) ||
    /[\s;&|`$<>(){}[\]!*?'"\\]/u.test(binary)
  ) {
    throw new AgentNotesError(
      ErrorCode.INTEGRATION_BINARY_UNSTABLE,
      "hook command 需要 stable agent-notes binary；請使用 global install 或 --binary 指定固定路徑"
    );
  }

  return binary;
}

export function localFileSummary(targetPath: string): string {
  return `${path.basename(targetPath)}#${createHash("sha256").update(path.resolve(targetPath)).digest("hex").slice(0, 8)}`;
}

export function firstExistingConfigSummary(input: {
  readonly context: PathOptions;
  readonly envRootName: string;
  readonly fallbackRoot: string;
  readonly fileNames: readonly string[];
}): string {
  const env = input.context.env ?? process.env;
  const configuredRoot = env[input.envRootName]?.trim();
  const root = resolvePath(configuredRoot === undefined || configuredRoot === "" ? input.fallbackRoot : configuredRoot, input.context);

  for (const fileName of input.fileNames) {
    const candidatePath = path.join(root, fileName);

    if (existsSync(candidatePath)) {
      return localFileSummary(candidatePath);
    }
  }

  return "not detected";
}

function isEphemeralBinary(binary: string): boolean {
  const normalized = binary.replaceAll("\\", "/").toLowerCase();
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const command = tokens[0] ?? "";
  const commandName = path.posix.basename(command);
  const subcommand = tokens[1] ?? "";

  return (
    commandName === "npx" ||
    commandName === "_npx" ||
    commandName === "bunx" ||
    (commandName === "npm" && (subcommand === "exec" || subcommand === "x")) ||
    (commandName === "pnpm" && subcommand === "dlx") ||
    (commandName === "yarn" && subcommand === "dlx") ||
    (commandName === "corepack" && tokens[1] === "pnpm" && tokens[2] === "dlx") ||
    /(?:^|\/)node_modules\/\.bin(?:\/|$)/u.test(normalized)
  );
}
