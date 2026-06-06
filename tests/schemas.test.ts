import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { AgentNotesError, ErrorCode } from "../src/core/errors.js";
import { canonicalizePath, expandPath, isVaultRelativePath, resolvePath } from "../src/core/paths.js";
import {
  parseLocalConfig,
  parseProjectMap,
  parseProvenanceEntry,
  parseSessionFrontmatter,
  parseSourceIndex
} from "../src/schemas/index.js";

const fixturesRoot = new URL("./fixtures/", import.meta.url);

async function readJsonFixture(relativePath: string): Promise<unknown> {
  const raw = await readFile(new URL(relativePath, fixturesRoot), "utf8");

  return JSON.parse(raw) as unknown;
}

function expectAgentNotesError(error: unknown, code: ErrorCode): void {
  expect(error).toBeInstanceOf(AgentNotesError);
  expect((error as AgentNotesError).code).toBe(code);
}

describe("path helpers", () => {
  it("展開 home path 並解析相對路徑", () => {
    const homeDir = path.join(tmpdir(), "agent-notes-home");
    const cwd = path.join(tmpdir(), "agent-notes-cwd");

    expect(expandPath("~/Vault", { homeDir })).toBe(path.join(homeDir, "Vault"));
    expect(expandPath("$HOME/Vault", { homeDir })).toBe(path.join(homeDir, "Vault"));
    expect(resolvePath("notes", { cwd, homeDir })).toBe(path.join(cwd, "notes"));
  });

  it("canonicalize existing path", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agent-notes-path-"));

    try {
      expect(canonicalizePath(directory, { mustExist: true })).toBe(realpathSync.native(directory));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("判斷 vault-relative path", () => {
    expect(isVaultRelativePath("03-Projects/Example")).toBe(true);
    expect(isVaultRelativePath("../outside")).toBe(false);
    expect(isVaultRelativePath("/tmp/Agent-Notes")).toBe(false);
    expect(isVaultRelativePath("$HOME/Agent-Notes")).toBe(false);
  });
});

describe("local config schema and loader", () => {
  it("解析 valid local config", async () => {
    const config = parseLocalConfig(await readJsonFixture("config/valid-local-config.json"));

    expect(config.locale).toBe("zh-TW");
    expect(config.sharing.mode).toBe("personal");
  });

  it("team mode 回傳 FEATURE_UNSUPPORTED", async () => {
    try {
      parseLocalConfig(await readJsonFixture("config/team-mode.json"));
      throw new Error("expected parseLocalConfig to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.FEATURE_UNSUPPORTED);
    }
  });

  it("缺 vaultPath 回傳 CONFIG_INVALID", async () => {
    try {
      parseLocalConfig(await readJsonFixture("config/missing-vault-path.json"));
      throw new Error("expected parseLocalConfig to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.CONFIG_INVALID);
    }
  });

  it("loadConfig 展開 $HOME path", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agent-notes-config-"));
    const homeDir = path.join(directory, "home");
    const configPath = path.join(directory, "config.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            version: 1,
            locale: "en",
            vaultPath: "$HOME/Documents/Agent-Notes",
            projectMapPath: "${HOME}/.config/agent-notes/project-map.json",
            privacy: {
              defaultVisibility: "private",
              recordAbsolutePathsInNotes: false,
              copyRawTranscripts: false
            },
            sharing: {
              mode: "personal",
              access: "read-write",
              agentWritePolicy: "local-only"
            },
            integrations: {
              codex: {
                enabled: false
              }
            }
          },
          null,
          2
        )
      );

      const config = loadConfig({
        configPath,
        homeDir,
        env: {
          HOME: homeDir
        }
      });

      expect(config.vaultPath).toBe(path.join(homeDir, "Documents/Agent-Notes"));
      expect(config.projectMapPath).toBe(path.join(homeDir, ".config/agent-notes/project-map.json"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("project map schema", () => {
  it("解析 empty project map", async () => {
    const projectMap = parseProjectMap(await readJsonFixture("project-map/valid-empty.json"));

    expect(projectMap.projects).toHaveLength(0);
  });

  it("拒絕 duplicate project id", async () => {
    try {
      parseProjectMap(await readJsonFixture("project-map/duplicate-id.json"));
      throw new Error("expected parseProjectMap to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PROJECT_MAP_INVALID);
    }
  });

  it("拒絕 absolute notePath", async () => {
    try {
      parseProjectMap(await readJsonFixture("project-map/absolute-note-path.json"));
      throw new Error("expected parseProjectMap to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PROJECT_MAP_INVALID);
    }
  });
});

describe("session and provenance schemas", () => {
  it("解析 project session frontmatter", async () => {
    const frontmatter = parseSessionFrontmatter(await readJsonFixture("session/valid-project-session.json"));

    expect(frontmatter.scope).toBe("project");
    expect(frontmatter.sourceRefs).toEqual(["src_20260606_codex_001"]);
  });

  it("拒絕 tracked session frontmatter 中的絕對 repoPath 欄位", async () => {
    try {
      parseSessionFrontmatter(await readJsonFixture("session/absolute-repo-path.json"));
      throw new Error("expected parseSessionFrontmatter to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.CONFIG_INVALID);
    }
  });

  it("解析 source index", async () => {
    const sourceIndex = parseSourceIndex({
      version: 1,
      sources: {
        src_20260606_codex_001: {
          kind: "summary-file",
          tool: "codex",
          capturedAt: "2026-06-06T12:00:00+08:00",
          sessionIds: ["SES-20260606-001"],
          localPath: "/tmp/agent-summary.md",
          contentHash: "sha256:example",
          privacy: "private",
          rawIncluded: false,
          redacted: false
        }
      }
    });

    expect(Object.keys(sourceIndex.sources)).toEqual(["src_20260606_codex_001"]);
  });

  it("拒絕 malformed source key", () => {
    try {
      parseSourceIndex({
        version: 1,
        sources: {
          bad_source: {
            kind: "summary-file",
            tool: "codex",
            capturedAt: "2026-06-06T12:00:00+08:00",
            sessionIds: ["SES-20260606-001"],
            localPath: "/tmp/agent-summary.md",
            privacy: "private",
            rawIncluded: false,
            redacted: false
          }
        }
      });
      throw new Error("expected parseSourceIndex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.CONFIG_INVALID);
    }
  });

  it("拒絕沒有 sourceRefs 的 provenance entry", () => {
    try {
      parseProvenanceEntry({
        version: 1,
        event: "derived-item-created",
        createdAt: "2026-06-06T12:05:00+08:00",
        sessionId: "SES-20260606-001",
        itemId: "DEC-0001",
        itemType: "decision",
        sourceRefs: [],
        derivedFrom: "summary-file:Decisions",
        notePath: "03-Projects/Example/03-context/decision-log.md",
        contentHash: "sha256:example"
      });
      throw new Error("expected parseProvenanceEntry to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.CONFIG_INVALID);
    }
  });
});
