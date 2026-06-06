import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { AgentNotesError, ErrorCode } from "./errors.js";
import { canonicalizePath, resolvePath, type PathOptions } from "./paths.js";
import { parseLocalConfig, type LocalConfig } from "../schemas/config.js";

export interface LoadConfigOptions extends PathOptions {
  readonly configPath?: string;
}

export function defaultConfigPath(options: PathOptions = {}): string {
  const homeDir = options.homeDir ?? options.env?.HOME ?? homedir();
  const configHome =
    options.env?.XDG_CONFIG_HOME !== undefined && options.env.XDG_CONFIG_HOME.trim() !== ""
      ? resolvePath(options.env.XDG_CONFIG_HOME, options)
      : path.join(homeDir, ".config");

  return path.join(configHome, "agent-notes", "config.json");
}

export function loadConfig(options: LoadConfigOptions = {}): LocalConfig {
  const configPathInput = options.configPath ?? defaultConfigPath(options);
  const configPath = canonicalizePath(configPathInput, {
    ...options,
    mustExist: true
  });

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new AgentNotesError(ErrorCode.CONFIG_NOT_FOUND, "找不到 Agent Notes local config");
    }

    throw new AgentNotesError(ErrorCode.CONFIG_INVALID, "local config 不是有效 JSON");
  }

  return parseLocalConfig(expandConfigPaths(parsedJson, options));
}

function expandConfigPaths(value: unknown, options: PathOptions): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const config = {
    ...(value as Record<string, unknown>)
  };

  if (typeof config.vaultPath === "string") {
    config.vaultPath = canonicalizePath(config.vaultPath, options);
  }

  if (typeof config.projectMapPath === "string") {
    config.projectMapPath = canonicalizePath(config.projectMapPath, options);
  }

  return config;
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
