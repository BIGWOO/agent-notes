import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadConfig, type LoadConfigOptions } from "../core/config.js";
import { AgentNotesError, ErrorCode } from "../core/errors.js";
import { readMarkerItems, validateMarkerContent, type GeneratedItem } from "../core/markerBlocks.js";
import { parseSessionCard } from "../core/markdown.js";
import { loadProvenanceLog, loadSourceIndex } from "../core/provenanceStore.js";
import {
  loadAgentNotesRuntime,
  readTrackedVaultMarkdown,
  trackedMarkdownFiles,
  validateAgentNotesVault,
  vaultRelativePath,
  type AgentNotesRuntime
} from "../core/runtime.js";
import { runIntegrateList } from "./integrate.js";

interface DoctorOptions {
  readonly check?: string;
  readonly json?: boolean;
}

export interface DoctorContext extends LoadConfigOptions {
  readonly stdout?: (value: string) => void;
}

export interface DoctorCheckResult {
  readonly code?: ErrorCode;
  readonly message: string;
  readonly name: DoctorCheckName;
  readonly paths: readonly string[];
  readonly status: "fail" | "info" | "pass";
}

export interface DoctorResult {
  readonly checks: readonly DoctorCheckResult[];
  readonly status: "fail" | "pass";
}

type DoctorCheckName = "config" | "integrations" | "markers" | "project-map" | "provenance" | "public-safe" | "templates" | "vault";

const doctorCheckNames: readonly DoctorCheckName[] = [
  "config",
  "vault",
  "project-map",
  "templates",
  "markers",
  "provenance",
  "public-safe",
  "integrations"
];

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("檢查 config、vault、project map、provenance 與 public-safe 風險")
    .option("--check <name>", "只執行指定檢查")
    .option("--json", "輸出 JSON")
    .action((options: DoctorOptions) => {
      runDoctorCommand(options);
    });
}

export function runDoctorCommand(options: DoctorOptions = {}, context: DoctorContext = {}): DoctorResult {
  const result = runDoctor(options, context);
  const output = context.stdout ?? ((value: string) => process.stdout.write(value));

  output(options.json === true ? `${JSON.stringify(result, null, 2)}\n` : formatDoctorResult(result));

  if (result.status === "fail") {
    const blocking = result.checks.find((check) => check.status === "fail" && check.code !== undefined);

    throw new AgentNotesError(blocking?.code ?? ErrorCode.UNKNOWN_ERROR, "doctor checks failed");
  }

  return result;
}

export function runDoctor(options: DoctorOptions = {}, context: DoctorContext = {}): DoctorResult {
  const requestedChecks = resolveRequestedChecks(options.check);
  const checks: DoctorCheckResult[] = [];
  let runtime: AgentNotesRuntime | undefined;

  if (requestedChecks.includes("config")) {
    checks.push(runConfigCheck(context));
  }

  if (requestedChecks.some((check) => check !== "config")) {
    try {
      runtime = loadAgentNotesRuntime(context);
    } catch (error) {
      checks.push(checkFromError("vault", error));

      return {
        checks,
        status: "fail"
      };
    }
  }

  if (runtime !== undefined) {
    for (const checkName of requestedChecks) {
      if (checkName === "config") {
        continue;
      }

      checks.push(runRuntimeCheck(checkName, runtime, context));
    }
  }

  return {
    checks,
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass"
  };
}

function runConfigCheck(context: DoctorContext): DoctorCheckResult {
  try {
    loadConfig(context);

    return pass("config", "local config valid");
  } catch (error) {
    return checkFromError("config", error);
  }
}

function runRuntimeCheck(checkName: Exclude<DoctorCheckName, "config">, runtime: AgentNotesRuntime, context: DoctorContext): DoctorCheckResult {
  try {
    switch (checkName) {
      case "vault":
        validateAgentNotesVault(runtime.vaultPath);
        assertVaultWritable(runtime.vaultPath);
        return pass("vault", "vault structure valid");
      case "project-map":
        return pass("project-map", `projects: ${runtime.projectMap.projects.length}`);
      case "templates":
        return checkTemplates(runtime);
      case "markers":
        return checkMarkers(runtime);
      case "provenance":
        return checkProvenance(runtime);
      case "public-safe":
        return checkPublicSafe(runtime);
      case "integrations":
        return checkIntegrations(runtime, context);
    }
  } catch (error) {
    return checkFromError(checkName, error);
  }
}

function checkTemplates(runtime: AgentNotesRuntime): DoctorCheckResult {
  const required = [
    path.join("00-Meta", "Systems", "agent-note-protocol.md"),
    path.join("06-Templates", "summary-file.md"),
    path.join("06-Templates", "session-card.md"),
    path.join("06-Templates", "project-README.md"),
    path.join("06-Templates", "active-tasks.md"),
    path.join("06-Templates", "decision-log.md"),
    path.join("06-Templates", "pitfalls.md")
  ];
  const missing = required.filter((relativePath) => !existsSync(path.join(runtime.vaultPath, relativePath)));

  if (missing.length > 0) {
    return fail("templates", ErrorCode.CONFIG_INVALID, "template missing", missing);
  }

  const summaryTemplate = readTrackedVaultMarkdown(runtime, path.posix.join("06-Templates", "summary-file.md"), ErrorCode.CONFIG_INVALID);
  const headingOrder = ["## Summary", "## Changes", "## Decisions", "## Validation", "## Next Steps", "## Handoff"];
  let lastIndex = -1;

  for (const heading of headingOrder) {
    const index = summaryTemplate.indexOf(heading);

    if (index <= lastIndex) {
      return fail("templates", ErrorCode.CONFIG_INVALID, "summary-file template headings invalid", ["06-Templates/summary-file.md"]);
    }

    lastIndex = index;
  }

  return pass("templates", "templates valid");
}

function checkMarkers(runtime: AgentNotesRuntime): DoctorCheckResult {
  const failures: string[] = [];

  for (const project of runtime.projectMap.projects) {
    for (const [fileName, blockId] of markerTargets()) {
      const notePath = path.posix.join(project.notePath, fileName);
      const targetPath = path.join(runtime.vaultPath, notePath);

      if (!existsSync(targetPath)) {
        failures.push(notePath);
        continue;
      }

      validateMarkerContent(readTrackedVaultMarkdown(runtime, notePath, ErrorCode.MARKER_MISSING), [blockId]);
    }
  }

  if (failures.length > 0) {
    return fail("markers", ErrorCode.MARKER_MISSING, "project marker file missing", failures);
  }

  return pass("markers", "marker blocks valid");
}

function checkProvenance(runtime: AgentNotesRuntime): DoctorCheckResult {
  const sourceIndex = loadSourceIndex(runtime.vaultPath);
  const provenance = loadProvenanceLog(runtime.vaultPath);
  const sessionIds = new Set(readSessionCards(runtime).map((session) => session.sessionId));
  const markerItems = readMarkerItemIndex(runtime);

  for (const [sourceRef, source] of Object.entries(sourceIndex.sources)) {
    for (const sessionId of source.sessionIds) {
      if (!sessionIds.has(sessionId)) {
        return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `source index session missing: ${sessionId}`, [sourceRef]);
      }
    }
  }

  for (const entry of provenance) {
    for (const sourceRef of entry.sourceRefs) {
      if (sourceIndex.sources[sourceRef] === undefined) {
        return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `provenance sourceRef missing: ${sourceRef}`, [entry.notePath]);
      }
    }

    if (!sessionIds.has(entry.sessionId)) {
      return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `provenance session missing: ${entry.sessionId}`, [entry.notePath]);
    }

    if (entry.event === "session-created") {
      continue;
    }

    if (entry.itemId === undefined) {
      return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, "provenance itemId missing", [entry.notePath]);
    }

    const markerItem = markerItems.find((item) => item.item.id === entry.itemId && item.notePath === entry.notePath);

    if (markerItem === undefined) {
      return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `provenance item missing in marker: ${entry.itemId}`, [entry.notePath]);
    }

    if (markerItem.item.sessionId !== entry.sessionId) {
      return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `provenance item session mismatch: ${entry.itemId}`, [entry.notePath]);
    }

    for (const sourceRef of entry.sourceRefs) {
      if (!markerItem.item.sourceRefs.includes(sourceRef)) {
        return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `provenance item sourceRef mismatch: ${entry.itemId}`, [entry.notePath]);
      }
    }
  }

  for (const markerItem of markerItems) {
    if (markerItem.item.sessionId === undefined || !sessionIds.has(markerItem.item.sessionId)) {
      return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `marker item session missing: ${markerItem.item.id}`, [markerItem.notePath]);
    }

    for (const sourceRef of markerItem.item.sourceRefs) {
      if (sourceIndex.sources[sourceRef] === undefined) {
        return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `marker item sourceRef missing: ${markerItem.item.id}`, [markerItem.notePath]);
      }
    }

    const matchingEntries = provenance.filter(
      (entry) =>
        entry.itemId === markerItem.item.id &&
        entry.notePath === markerItem.notePath &&
        entry.sessionId === markerItem.item.sessionId
    );

    if (matchingEntries.length === 0) {
      return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `marker item missing provenance: ${markerItem.item.id}`, [markerItem.notePath]);
    }

    for (const sourceRef of markerItem.item.sourceRefs) {
      if (!matchingEntries.some((entry) => entry.sourceRefs.includes(sourceRef))) {
        return fail("provenance", ErrorCode.PROVENANCE_ORPHAN, `marker item sourceRef missing provenance: ${markerItem.item.id}`, [
          markerItem.notePath
        ]);
      }
    }
  }

  return pass("provenance", `entries: ${provenance.length}`);
}

function readMarkerItemIndex(runtime: AgentNotesRuntime): {
  readonly item: GeneratedItem;
  readonly notePath: string;
}[] {
  return runtime.projectMap.projects.flatMap((project) =>
    markerTargets().flatMap(([fileName, blockId]) => {
      const notePath = path.posix.join(project.notePath, fileName);
      const targetPath = path.join(runtime.vaultPath, notePath);

      if (!existsSync(targetPath)) {
        return [];
      }

      const items = readMarkerItems(readTrackedVaultMarkdown(runtime, notePath, ErrorCode.MARKER_MISSING), blockId);

      return Array.isArray(items) ? items.map((item) => ({ item, notePath })) : [];
    })
  );
}

function checkPublicSafe(runtime: AgentNotesRuntime): DoctorCheckResult {
  for (const targetPath of trackedMarkdownFiles(runtime)) {
    const content = readFileSync(targetPath, "utf8");
    const risk = publicSafeRisk(content);

    if (risk !== undefined) {
      return fail("public-safe", ErrorCode.PRIVATE_DATA_RISK, `tracked Markdown contains blocked pattern: ${risk}`, [
        vaultRelativePath(runtime, targetPath)
      ]);
    }
  }

  return pass("public-safe", "tracked Markdown passed heuristic scan");
}

function checkIntegrations(runtime: AgentNotesRuntime, context: DoctorContext): DoctorCheckResult {
  const codexEnabled = runtime.config.integrations.codex?.enabled === true;
  const list = runIntegrateList(context);
  const codex = list.integrations.find((integration) => integration.agent === "codex");

  if (codexEnabled && codex?.status === "not-found") {
    return fail("integrations", ErrorCode.INTEGRATION_NOT_FOUND, "Codex integration enabled but config not found", []);
  }

  if (codexEnabled && codex?.status === "unsupported") {
    return fail("integrations", ErrorCode.INTEGRATION_UNSUPPORTED, "Codex integration enabled but config unsupported", []);
  }

  return {
    message: `codex: ${codex?.status ?? "unknown"}`,
    name: "integrations",
    paths: [],
    status: codexEnabled ? "pass" : "info"
  };
}

function readSessionCards(runtime: AgentNotesRuntime): {
  readonly notePath: string;
  readonly sessionId: string;
}[] {
  return trackedMarkdownFiles(runtime)
    .map((targetPath) => {
      const parsed = parseSessionCard(readFileSync(targetPath, "utf8"));

      return parsed?.sessionId === undefined
        ? undefined
        : {
            notePath: vaultRelativePath(runtime, targetPath),
            sessionId: parsed.sessionId
          };
    })
    .filter((session): session is { readonly notePath: string; readonly sessionId: string } => session !== undefined);
}

function publicSafeRisk(content: string): string | undefined {
  const normalized = content.replaceAll("\\", "/");
  const patterns = [
    ["local absolute path", /(^|[\s"'`=])(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])/u],
    ["home path alias", /(^|[\s"'`=])(?:~\/|\$HOME(?:\/|\b)|\$\{HOME\}(?:\/|\b))/u],
    ["private path", /(^|[\\/.\s"'`])(?:\.agent-notes|private)(?:[\\/]|$)/u],
    ["credential file", /(^|[\\/.\s])(?:\.env(?:\.[\w-]+)?|\.npmrc|credentials?\.json|service-account(?:\.json)?)(?:$|[\s"'`\\/,])/u],
    ["token prefix", /\b(?:sk-[A-Za-z0-9]|ghp_[A-Za-z0-9]|xox[A-Za-z0-9-]*|AKIA[0-9A-Z]{4,}|AIza[0-9A-Za-z_-]+)/u],
    ["local pointer field", /\b(?:sourceFilePath|repoPath|vaultPath|projectMapPath|homePath)\s*[:=]/u],
    ["raw transcript", /\braw transcript\b|rawIncluded\s*:\s*true|private\/raw-sessions/u]
  ] as const;

  return patterns.find(([_label, pattern]) => pattern.test(normalized))?.[0];
}

function markerTargets(): readonly (readonly [string, string])[] {
  return [
    ["README.md", "project-summary"],
    ["active-tasks.md", "active-tasks"],
    ["decision-log.md", "decision-log"],
    ["pitfalls.md", "pitfalls"]
  ];
}

function resolveRequestedChecks(input: string | undefined): readonly DoctorCheckName[] {
  if (input === undefined) {
    return doctorCheckNames;
  }

  if (doctorCheckNames.includes(input as DoctorCheckName)) {
    return [input as DoctorCheckName];
  }

  throw new AgentNotesError(ErrorCode.FEATURE_UNSUPPORTED, `doctor 不支援 check: ${input}`);
}

function assertVaultWritable(vaultPath: string): void {
  try {
    accessSync(vaultPath, constants.R_OK | constants.W_OK);
  } catch (error) {
    if (isPermissionError(error)) {
      throw new AgentNotesError(ErrorCode.VAULT_NOT_WRITABLE, "vault 不可寫入");
    }

    throw error;
  }
}

function isPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && ["EACCES", "EPERM", "EROFS"].includes(String(error.code));
}

function pass(name: DoctorCheckName, message: string): DoctorCheckResult {
  return {
    message,
    name,
    paths: [],
    status: "pass"
  };
}

function fail(name: DoctorCheckName, code: ErrorCode, message: string, paths: readonly string[]): DoctorCheckResult {
  return {
    code,
    message,
    name,
    paths,
    status: "fail"
  };
}

function checkFromError(name: DoctorCheckName, error: unknown): DoctorCheckResult {
  if (error instanceof AgentNotesError) {
    return fail(name, error.code, error.message, []);
  }

  return fail(name, ErrorCode.UNKNOWN_ERROR, error instanceof Error ? error.message : "未知錯誤", []);
}

function formatDoctorResult(result: DoctorResult): string {
  return [
    `Agent Notes doctor: ${result.status}`,
    ...result.checks.map((check) =>
      [
        `- ${check.name}: ${check.status}`,
        check.code === undefined ? "" : ` (${check.code})`,
        ` - ${check.message}`,
        check.paths.length === 0 ? "" : ` [${check.paths.join(", ")}]`
      ].join("")
    )
  ].join("\n") + "\n";
}
