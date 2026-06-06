import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runInit, runInitCommand } from "../src/commands/init.js";
import { buildProjectContextWrites } from "../src/commands/project.js";
import { AgentNotesError, ErrorCode } from "../src/core/errors.js";
import type { ProjectMapEntry } from "../src/schemas/projectMap.js";

function makeWorkspace(): {
  readonly root: string;
  readonly configHome: string;
  readonly home: string;
  readonly vaultPath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "agent-notes-init-"));

  return {
    root,
    configHome: path.join(root, "xdg-config"),
    home: path.join(root, "home"),
    vaultPath: path.join(root, "Agent-Notes")
  };
}

function makeUserHomeWorkspace(): ReturnType<typeof makeWorkspace> {
  const homeRoot = process.env.HOME ?? tmpdir();
  const parent = path.join(homeRoot, ".cache", "agent-notes-tests");

  mkdirSync(parent, {
    recursive: true
  });

  const root = mkdtempSync(path.join(parent, "init-"));

  return {
    root,
    configHome: path.join(root, "xdg-config"),
    home: path.join(root, "home"),
    vaultPath: path.join(root, "Agent-Notes")
  };
}

function cleanup(directory: string): void {
  rmSync(directory, {
    recursive: true,
    force: true
  });
}

function writeFixtureFile(targetPath: string, content: string): void {
  mkdirSync(path.dirname(targetPath), {
    recursive: true
  });
  writeFileSync(targetPath, content);
}

function createGitRepo(repoPath: string): void {
  mkdirSync(repoPath, {
    recursive: true
  });
  execFileSync("git", ["init"], {
    cwd: repoPath,
    stdio: "ignore"
  });
}

function createValidVault(vaultPath: string): void {
  writeFixtureFile(path.join(vaultPath, ".gitignore"), "private/\n.agent-notes/\n");
  writeFixtureFile(path.join(vaultPath, "00-Meta", "Systems", "agent-note-protocol.md"), "# Agent Notes Protocol\n");
  writeFixtureFile(path.join(vaultPath, "06-Templates", "summary-file.md"), "## Summary\n");
}

function writeLocalConfig(workspace: ReturnType<typeof makeWorkspace>, vaultPath = workspace.vaultPath): void {
  const projectMapPath = path.join(workspace.configHome, "agent-notes", "project-map.json");

  writeFixtureFile(
    path.join(workspace.configHome, "agent-notes", "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        locale: "zh-TW",
        vaultPath,
        projectMapPath,
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
    )}\n`
  );
  writeFixtureFile(
    projectMapPath,
    `${JSON.stringify(
      {
        version: 1,
        vaultPath,
        projects: []
      },
      null,
      2
    )}\n`
  );
}

function plannedInitWrites(
  workspace: ReturnType<typeof makeWorkspace>,
  firstProject?: ProjectMapEntry
): { readonly targetPath: string; readonly content: string }[] {
  const configPath = path.join(workspace.configHome, "agent-notes", "config.json");
  const projectMapPath = path.join(workspace.configHome, "agent-notes", "project-map.json");
  const localConfig = {
    version: 1,
    locale: "zh-TW",
    vaultPath: workspace.vaultPath,
    projectMapPath,
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
  };
  const projectMap = {
    version: 1,
    vaultPath: workspace.vaultPath,
    projects: firstProject === undefined ? [] : [firstProject]
  };
  const write = (relativePath: string, content: string): { readonly targetPath: string; readonly content: string } => ({
    targetPath: path.join(workspace.vaultPath, relativePath),
    content
  });

  return [
    write(".gitignore", "private/\n.agent-notes/\n.DS_Store\n"),
    write(
      "00-Meta/Systems/agent-note-protocol.md",
      "# Agent Notes Protocol\n\nThis vault was created by Agent Notes.\n\nGenerated blocks are managed by the `agent-notes` CLI. Manual notes should live outside generated marker blocks.\n"
    ),
    write("06-Templates/summary-file.md", "## Summary\n\n## Changes\n\n## Decisions\n\n## Validation\n\n## Next Steps\n\n## Handoff\n"),
    write(
      "06-Templates/session-card.md",
      `---
type: agent-session
schemaVersion: 1
title: "{{title}}"
date: "{{date}}"
capturedAt: "{{capturedAt}}"
agent: "{{agent}}"
tool: "{{tool}}"
scope: "{{scope}}"
status: "{{status}}"
visibility: private
source:
  kind: "{{sourceKind}}"
  ref: "{{sourceRef}}"
  rawIncluded: false
sourceRefs:
  - "{{sourceRef}}"
derivedItems:
  decisions: []
  tasks: []
  contextUpdates: []
tags:
  - session
---

# {{title}}

## Summary

{{summary}}

## Changes

{{changes}}

## Decisions

{{decisions}}

## Validation

{{validation}}

## Next Steps

{{nextSteps}}

## Handoff

{{handoff}}

## Source

{{sourceSummary}}
`
    ),
    write(
      "06-Templates/project-README.md",
      "# {{projectName}}\n\nManual notes live outside generated blocks.\n\n<!-- agent-notes:start project-summary -->\n<!-- agent-notes:end project-summary -->\n"
    ),
    write(
      "06-Templates/active-tasks.md",
      "# Active Tasks\n\nManual notes live outside generated blocks.\n\n<!-- agent-notes:start active-tasks -->\n<!-- agent-notes:end active-tasks -->\n"
    ),
    write(
      "06-Templates/decision-log.md",
      "# Decision Log\n\nManual notes live outside generated blocks.\n\n<!-- agent-notes:start decision-log -->\n<!-- agent-notes:end decision-log -->\n"
    ),
    write(
      "06-Templates/pitfalls.md",
      "# Pitfalls\n\nManual notes live outside generated blocks.\n\n<!-- agent-notes:start pitfalls -->\n<!-- agent-notes:end pitfalls -->\n"
    ),
    write("01-Inbox/shared-capture/.gitkeep", ""),
    write("02-Daily/.gitkeep", ""),
    write("03-Projects/.gitkeep", ""),
    write("04-Areas/.gitkeep", ""),
    write("05-Resources/.gitkeep", ""),
    write("07-Archives/.gitkeep", ""),
    write("private/raw-sessions/.gitkeep", ""),
    ...(firstProject === undefined ? [] : buildProjectContextWrites(workspace.vaultPath, firstProject)),
    {
      targetPath: configPath,
      content: `${JSON.stringify(localConfig, null, 2)}\n`
    },
    {
      targetPath: projectMapPath,
      content: `${JSON.stringify(projectMap, null, 2)}\n`
    }
  ];
}

function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonicalVaultPathKeyForTest(vaultPath: string): string {
  const resolvedVaultPath = path.resolve(vaultPath);
  let currentPath = resolvedVaultPath;

  while (!existsSync(currentPath)) {
    const parent = path.dirname(currentPath);

    if (parent === currentPath) {
      return resolvedVaultPath;
    }

    currentPath = parent;
  }

  return path.join(realpathSync.native(currentPath), path.relative(currentPath, resolvedVaultPath));
}

function initStateForWorkspace(workspace: ReturnType<typeof makeWorkspace>): Record<string, unknown> {
  const writes = plannedInitWrites(workspace);

  return {
    version: 1,
    operationId: "init",
    command: "init",
    status: "in-progress",
    targetVaultPathKey: canonicalVaultPathKeyForTest(workspace.vaultPath),
    locale: "zh-TW",
    vaultPath: workspace.vaultPath,
    configPath: path.join(workspace.configHome, "agent-notes", "config.json"),
    projectMapPath: path.join(workspace.configHome, "agent-notes", "project-map.json"),
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    files: writes.map((write) => ({
      targetPath: write.targetPath,
      contentHash: hashContent(write.content)
    }))
  };
}

function initStateFirstProject(
  workspace: ReturnType<typeof makeWorkspace>,
  overrides: Partial<ProjectMapEntry> = {}
): ProjectMapEntry {
  return {
    id: "example-repo",
    name: "Example Repo",
    repoId: "example-repo",
    repoPaths: [path.join(workspace.root, "example-repo")],
    notePath: "03-Projects/Example Repo",
    tags: ["example-repo"],
    visibility: "private",
    ...overrides
  };
}

function writeInitState(workspace: ReturnType<typeof makeWorkspace>, state: Record<string, unknown> = initStateForWorkspace(workspace)): void {
  const statePath = path.join(workspace.configHome, "agent-notes", "init-state.json");

  writeFixtureFile(statePath, initStateStoreJson(state));
}

function initStateStoreJson(state: Record<string, unknown>): string {
  const targetVaultPathKey = state.targetVaultPathKey;

  if (typeof targetVaultPathKey !== "string") {
    throw new Error("test init state requires targetVaultPathKey");
  }

  return `${JSON.stringify(
    {
      version: 1,
      command: "init",
      states: {
        [targetVaultPathKey]: state
      }
    },
    null,
    2
  )}\n`;
}

function expectAgentNotesError(error: unknown, code: ErrorCode): void {
  expect(error).toBeInstanceOf(AgentNotesError);
  expect((error as AgentNotesError).code).toBe(code);
}

describe("init command", () => {
  it("dry-run 不寫入 vault、config、project map 或 init-state", async () => {
    const workspace = makeWorkspace();

    try {
      const result = await runInit(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      expect(result.batch.plan.filesToCreate.length).toBeGreaterThan(0);
      expect(existsSync(workspace.vaultPath)).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "config.json"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "project-map.json"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("dry-run 輸出不顯示本機絕對路徑", async () => {
    const workspace = makeWorkspace();
    const stdout: string[] = [];

    try {
      await runInitCommand(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          stdout: (value) => stdout.push(value)
        }
      );

      const output = stdout.join("");

      expect(output).toContain("Agent Notes init dry-run");
      expect(output).toContain("redacted vault path");
      expect(output).toContain("redacted local config path");
      expect(output).not.toContain(workspace.vaultPath);
      expect(output).not.toContain(workspace.configHome);
      expect(output).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("dry-run 未指定 --no-integrations 時顯示 integration preview next step 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const stdout: string[] = [];

    try {
      const result = await runInitCommand(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          stdout: (value) => stdout.push(value)
        }
      );
      const output = stdout.join("");

      expect(result.integrations?.status).toBe("preview");
      expect(result.integrations?.selectedAgents).toEqual(["codex"]);
      expect(output).toContain("integrations: preview codex");
      expect(output).toContain("integrationNext: agent-notes integrate --list");
      expect(output).not.toContain(workspace.home);
      expect(existsSync(workspace.vaultPath)).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("非互動 apply 建立 vault skeleton、config 與 project map", async () => {
    const workspace = makeWorkspace();

    try {
      const result = await runInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      const configPath = path.join(workspace.configHome, "agent-notes", "config.json");
      const projectMapPath = path.join(workspace.configHome, "agent-notes", "project-map.json");

      expect(result.result.written.length).toBeGreaterThan(0);
      expect(readFileSync(path.join(workspace.vaultPath, ".gitignore"), "utf8")).toContain(".agent-notes/");
      expect(existsSync(path.join(workspace.vaultPath, "00-Meta", "Systems", "agent-note-protocol.md"))).toBe(
        true
      );
      expect(existsSync(path.join(workspace.vaultPath, "06-Templates", "summary-file.md"))).toBe(true);
      expect(existsSync(path.join(workspace.vaultPath, "private", "raw-sessions", ".gitkeep"))).toBe(true);
      expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
        version: 1,
        locale: "zh-TW",
        vaultPath: workspace.vaultPath,
        projectMapPath
      });
      expect(JSON.parse(readFileSync(projectMapPath, "utf8"))).toEqual({
        version: 1,
        vaultPath: workspace.vaultPath,
        projects: []
      });
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動模式可延後 integration onboarding 並完成 init", async () => {
    const workspace = makeWorkspace();
    const prompts: string[] = [];

    try {
      const result = await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return prompts.length === 2;
          }
        }
      );

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("optional AI agent integrations");
      expect(prompts[1]).toContain("integrations: deferred");
      expect(result.integrations?.status).toBe("deferred");
      expect(result.integrations?.nextCommands).toEqual(["agent-notes integrate --list"]);
      expect(result.result.written.length).toBeGreaterThan(0);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動模式可選擇 Codex integration preview 但不寫 hook 設定", async () => {
    const workspace = makeWorkspace();
    const prompts: string[] = [];
    const stdout: string[] = [];

    try {
      const result = await runInitCommand(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return true;
          },
          stdout: (value) => stdout.push(value)
        }
      );
      const output = stdout.join("");

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("codex: next Phase 1 integration workstream");
      expect(prompts[1]).toContain("integrations: preview codex");
      expect(result.integrations?.status).toBe("preview");
      expect(result.integrations?.selectedAgents).toEqual(["codex"]);
      expect(output).toContain("integrationNext: agent-notes integrate --list");
      expect(output).not.toContain(".codex");
      expect(existsSync(path.join(workspace.home, ".codex"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("非互動 apply 可用 --project-repo 建立第一個 project", async () => {
    const workspace = makeWorkspace();
    const repoPath = path.join(workspace.root, "example-repo");

    try {
      createGitRepo(repoPath);

      const result = await runInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          projectRepo: repoPath
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      const projectMapPath = path.join(workspace.configHome, "agent-notes", "project-map.json");
      const projectMap = JSON.parse(readFileSync(projectMapPath, "utf8"));
      const readmePath = path.join(workspace.vaultPath, "03-Projects", "Example Repo", "README.md");

      expect(result.firstProject?.entry.id).toBe("example-repo");
      expect(result.firstProject?.source).toBe("explicit");
      expect(result.result.written).toHaveLength(21);
      expect(projectMap.projects).toHaveLength(1);
      expect(projectMap.projects[0]).toMatchObject({
        id: "example-repo",
        name: "Example Repo",
        repoId: "example-repo",
        notePath: "03-Projects/Example Repo",
        visibility: "private"
      });
      expect(projectMap.projects[0].repoPaths).toEqual([realpathSync.native(repoPath)]);
      expect(readFileSync(readmePath, "utf8")).toContain("# Example Repo");
      expect(readFileSync(readmePath, "utf8")).not.toContain(repoPath);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it.each([
    {
      label: "standalone home alias",
      repoName: "~"
    },
    {
      label: "Windows drive path",
      repoName: "C:\\Users"
    },
    {
      label: "UNC path",
      repoName: "\\\\server\\share"
    },
    {
      label: "normalized private path",
      repoName: "\\private"
    }
  ])("fresh --project-repo 拒絕會寫入 tracked Markdown 的本機指標名稱: $label", async ({ repoName }) => {
    const workspace = makeWorkspace();
    const repoPath = path.join(workspace.root, repoName);

    try {
      createGitRepo(repoPath);

      await runInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          projectRepo: repoPath
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PRIVATE_DATA_RISK);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動模式確認 safe git cwd 後若名稱會污染 Markdown 則拒絕第一個 project", async () => {
    const workspace = makeUserHomeWorkspace();
    const repoPath = path.join(workspace.home, "repos", "~");
    const prompts: string[] = [];

    try {
      createGitRepo(repoPath);

      await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false
        },
        {
          cwd: repoPath,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return true;
          }
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PRIVATE_DATA_RISK);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("current git repo");
      expect(prompts[0]).not.toContain(repoPath);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("dry-run 可規劃 --project-repo 且不輸出 repo 絕對路徑", async () => {
    const workspace = makeWorkspace();
    const repoPath = path.join(workspace.root, "example-repo");
    const stdout: string[] = [];

    try {
      createGitRepo(repoPath);

      const result = await runInitCommand(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          projectRepo: repoPath
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          stdout: (value) => stdout.push(value)
        }
      );
      const output = stdout.join("");

      expect(result.firstProject?.entry.id).toBe("example-repo");
      expect(result.batch.plan.filesToCreate).toHaveLength(21);
      expect(output).toContain("firstProject: example-repo");
      expect(output).toContain("firstProjectRepo: example-repo#");
      expect(output).not.toContain(repoPath);
      expect(output).not.toContain(workspace.root);
      expect(existsSync(workspace.vaultPath)).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "project-map.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("已初始化且 config 指向 valid vault 時可重跑且不寫入", async () => {
    const workspace = makeWorkspace();

    try {
      createValidVault(workspace.vaultPath);
      writeLocalConfig(workspace);

      const result = await runInit(
        {},
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      expect(result.status).toBe("already-initialized");
      expect(result.result.written).toHaveLength(0);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
      expect(readFileSync(path.join(workspace.vaultPath, "00-Meta", "Systems", "agent-note-protocol.md"), "utf8")).toBe(
        "# Agent Notes Protocol\n"
      );
    } finally {
      cleanup(workspace.root);
    }
  });

  it("既有 valid vault 但 local config 未指向時拒絕採用", async () => {
    const workspace = makeWorkspace();

    try {
      createValidVault(workspace.vaultPath);

      await runInit(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.VAULT_ALREADY_INITIALIZED);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("缺少非互動必要 flags 回 NON_INTERACTIVE_REQUIRED", async () => {
    const workspace = makeWorkspace();

    try {
      await runInit(
        {
          yes: true,
          lang: "en",
          vaultPath: workspace.vaultPath
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.NON_INTERACTIVE_REQUIRED);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("非互動 --yes 未明確 --no-integrations 時回 NON_INTERACTIVE_REQUIRED", async () => {
    const workspace = makeWorkspace();

    try {
      await runInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.NON_INTERACTIVE_REQUIRED);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("--no-project 與 --project-repo 同時使用時回 CONFIG_INVALID", async () => {
    const workspace = makeWorkspace();

    try {
      await runInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false,
          projectRepo: path.join(workspace.root, "repo")
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.CONFIG_INVALID);
      expect(existsSync(path.join(workspace.vaultPath, ".gitignore"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("缺少 --yes 且無互動 confirm 時回 NON_INTERACTIVE_REQUIRED", async () => {
    const workspace = makeWorkspace();

    try {
      await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.NON_INTERACTIVE_REQUIRED);
      expect(existsSync(path.join(workspace.vaultPath, ".gitignore"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動 confirm 取消時回 INIT_CANCELLED 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const prompts: string[] = [];

    try {
      await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return false;
          }
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_CANCELLED);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("files to create: 17");
      expect(existsSync(path.join(workspace.vaultPath, ".gitignore"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "config.json"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動 confirm 接受後建立 vault、config 與 project map", async () => {
    const workspace = makeWorkspace();

    try {
      const result = await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: () => true
        }
      );

      expect(result.status).toBe("planned");
      expect(result.result.written).toHaveLength(17);
      expect(readFileSync(path.join(workspace.vaultPath, ".gitignore"), "utf8")).toContain("private/");
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "config.json"))).toBe(true);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "project-map.json"))).toBe(true);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動模式可詢問並加入 safe git cwd 作為第一個 project", async () => {
    const workspace = makeUserHomeWorkspace();
    const repoPath = path.join(workspace.home, "repos", "current-repo");
    const prompts: string[] = [];

    try {
      createGitRepo(repoPath);

      const result = await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false
        },
        {
          cwd: repoPath,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return true;
          }
        }
      );
      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("current git repo");
      expect(prompts[0]).toContain("current-repo#");
      expect(prompts[0]).not.toContain(repoPath);
      expect(prompts[1]).toContain("first project: current-repo");
      expect(result.firstProject?.entry.id).toBe("current-repo");
      expect(result.firstProject?.source).toBe("cwd");
      expect(projectMap.projects).toHaveLength(1);
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Current Repo", "README.md"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動模式在非 git cwd 不詢問第一個 project", async () => {
    const workspace = makeWorkspace();
    const prompts: string[] = [];

    try {
      const result = await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return true;
          }
        }
      );
      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("Agent Notes init will create");
      expect(result.firstProject).toBeUndefined();
      expect(projectMap.projects).toHaveLength(0);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("互動模式在系統目錄 descendant git cwd 不詢問第一個 project", async () => {
    const workspace = makeWorkspace();
    const unsafeRoot = "/private/tmp";
    const prompts: string[] = [];

    if (!existsSync(unsafeRoot)) {
      cleanup(workspace.root);
      return;
    }

    const repoPath = mkdtempSync(path.join(unsafeRoot, "agent-notes-unsafe-repo-"));

    try {
      createGitRepo(repoPath);

      const result = await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false
        },
        {
          cwd: repoPath,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return true;
          }
        }
      );
      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(prompts).toHaveLength(1);
      expect(result.firstProject).toBeUndefined();
      expect(projectMap.projects).toHaveLength(0);
    } finally {
      cleanup(workspace.root);
      cleanup(repoPath);
    }
  });

  it("互動模式在 HOME symlink 指向系統目錄 descendant 時不加入第一個 project", async () => {
    const workspace = makeWorkspace();
    const unsafeRoot = "/private/tmp";
    const prompts: string[] = [];

    if (!existsSync(unsafeRoot)) {
      cleanup(workspace.root);
      return;
    }

    const unsafeHome = mkdtempSync(path.join(unsafeRoot, "agent-notes-unsafe-home-"));
    const linkedHome = path.join(workspace.root, "linked-home");
    const repoPath = path.join(linkedHome, "repos", "current-repo");

    try {
      symlinkSync(unsafeHome, linkedHome, "dir");
      createGitRepo(repoPath);

      const result = await runInit(
        {
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false
        },
        {
          cwd: repoPath,
          env: {
            HOME: linkedHome,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: linkedHome,
          confirm: (prompt) => {
            prompts.push(prompt.message);

            return true;
          }
        }
      );
      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("Agent Notes init will create");
      expect(result.firstProject).toBeUndefined();
      expect(projectMap.projects).toHaveLength(0);
    } finally {
      cleanup(workspace.root);
      cleanup(unsafeHome);
    }
  });

  it("既有非 Agent Notes 目錄非空時拒絕覆蓋", async () => {
    const workspace = makeWorkspace();

    try {
      writeFixtureFile(path.join(workspace.vaultPath, "existing.md"), "manual");

      await runInit(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.VAULT_EXISTS_NON_EMPTY);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("既有 target 是檔案時回 PATH_INVALID", async () => {
    const workspace = makeWorkspace();

    try {
      writeFixtureFile(workspace.vaultPath, "not a directory");

      await runInit(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PATH_INVALID);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("target 位於 Git worktree 內時回 PATH_UNSAFE 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const unsafeVaultPath = path.join(workspace.root, "repo", "Agent-Notes");

    try {
      mkdirSync(path.dirname(unsafeVaultPath), {
        recursive: true
      });
      execFileSync("git", ["init"], {
        cwd: path.dirname(unsafeVaultPath),
        stdio: "ignore"
      });

      await runInit(
        {
          dryRun: true,
          vaultPath: unsafeVaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
      expect(existsSync(unsafeVaultPath)).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "config.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("明確允許 Git worktree vault 時可 dry-run 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const unsafeVaultPath = path.join(workspace.root, "repo", "Agent-Notes");

    try {
      mkdirSync(path.dirname(unsafeVaultPath), {
        recursive: true
      });
      execFileSync("git", ["init"], {
        cwd: path.dirname(unsafeVaultPath),
        stdio: "ignore"
      });

      const result = await runInit(
        {
          dryRun: true,
          vaultPath: unsafeVaultPath,
          integrations: false,
          project: false,
          allowGitWorktreeVault: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      expect(result.batch.plan.filesToCreate.length).toBeGreaterThan(0);
      expect(existsSync(unsafeVaultPath)).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "config.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("既有 local config 無效時回 CONFIG_INVALID 且不覆蓋", async () => {
    const workspace = makeWorkspace();
    const configPath = path.join(workspace.configHome, "agent-notes", "config.json");

    try {
      writeFixtureFile(configPath, "{ invalid json");

      await runInit(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.CONFIG_INVALID);
      expect(readFileSync(configPath, "utf8")).toBe("{ invalid json");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("偵測到 partial init state 時要求明確 resume 或 rollback", async () => {
    const workspace = makeWorkspace();

    try {
      writeInitState(workspace);

      await runInit(
        {
          dryRun: true,
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_PARTIAL);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 只補 pending init files 並移除 init-state", async () => {
    const workspace = makeWorkspace();

    try {
      const writes = plannedInitWrites(workspace);
      writeInitState(workspace);
      writeFixtureFile(writes[0].targetPath, writes[0].content);
      writeFixtureFile(writes[1].targetPath, writes[1].content);

      const result = await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      expect(result.status).toBe("resumed");
      expect(result.batch.plan.filesToSkip).toContain(writes[0].targetPath);
      expect(result.batch.plan.filesToSkip).toContain(writes[1].targetPath);
      expect(readFileSync(path.join(workspace.vaultPath, "06-Templates", "summary-file.md"), "utf8")).toBe(
        writes[2].content
      );
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "config.json"))).toBe(true);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "project-map.json"))).toBe(true);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 遇到已被使用者修改的 partial file 時拒絕覆蓋", async () => {
    const workspace = makeWorkspace();

    try {
      const writes = plannedInitWrites(workspace);
      writeInitState(workspace);
      writeFixtureFile(writes[0].targetPath, "user edit");

      await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      expect(readFileSync(path.join(workspace.vaultPath, ".gitignore"), "utf8")).toBe("user edit");
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume conflict error 不輸出完整本機路徑", async () => {
    const workspace = makeWorkspace();

    try {
      const writes = plannedInitWrites(workspace);
      writeInitState(workspace);
      writeFixtureFile(writes[0].targetPath, "user edit");

      await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      expect((error as AgentNotesError).message).toContain(".gitignore");
      expect((error as AgentNotesError).message).not.toContain(workspace.root);
      expect((error as AgentNotesError).message).not.toContain(workspace.vaultPath);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 拒絕 relative init-state target path", async () => {
    const workspace = makeWorkspace();

    try {
      writeInitState(workspace, {
        ...initStateForWorkspace(workspace),
        files: [
          {
            targetPath: "relative.md",
            contentHash: hashContent("content")
          }
        ]
      });

      await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_PARTIAL);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 拒絕 schema 無效的 init-state firstProject", async () => {
    const workspace = makeWorkspace();
    const state = initStateForWorkspace(workspace);

    try {
      writeInitState(workspace, {
        ...state,
        firstProject: {
          id: "bad id",
          name: "Bad Project",
          repoId: "bad-project",
          repoPaths: [workspace.root],
          notePath: "03-Projects/Bad Project",
          tags: ["bad id"],
          visibility: "private"
        },
        firstProjectSource: "explicit"
      });

      await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_PARTIAL);
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Bad Project", "README.md"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it.each([
    {
      label: "POSIX absolute path",
      projectName: "/usr/local/repo"
    },
    {
      label: "macOS user absolute path",
      projectName: "/Users/example/repo"
    },
    {
      label: "POSIX UNC path",
      projectName: "//server/share"
    },
    {
      label: "agent notes private directory",
      projectName: ".agent-notes"
    },
    {
      label: "braced home alias",
      projectName: "${HOME}"
    }
  ])("resume 拒絕 firstProject name 寫入本機指標到 Markdown: $label", async ({ projectName }) => {
    const workspace = makeWorkspace();
    const state = initStateForWorkspace(workspace);

    try {
      writeInitState(workspace, {
        ...state,
        firstProject: {
          id: "unsafe-project",
          name: projectName,
          repoId: "unsafe-project",
          repoPaths: [workspace.root],
          notePath: "03-Projects/Unsafe Project",
          tags: ["unsafe-project"],
          visibility: "private"
        },
        firstProjectSource: "explicit"
      });

      await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_PARTIAL);
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Unsafe Project", "README.md"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 拒絕超出 allowlist 的 absolute init-state target path", async () => {
    const workspace = makeWorkspace();

    try {
      writeInitState(workspace, {
        ...initStateForWorkspace(workspace),
        files: [
          {
            targetPath: path.join(workspace.root, "outside.md"),
            contentHash: hashContent("content")
          }
        ]
      });

      await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_PARTIAL);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 拒絕格式無效的 init-state contentHash", async () => {
    const workspace = makeWorkspace();
    const writes = plannedInitWrites(workspace);

    try {
      writeInitState(workspace, {
        ...initStateForWorkspace(workspace),
        files: [
          {
            targetPath: writes[0].targetPath,
            contentHash: "sha256:bad"
          }
        ]
      });

      await runInit(
        {
          resume: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_PARTIAL);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 使用 symlink alias 與實體路徑時仍找到同一個 init-state", async () => {
    const workspace = makeWorkspace();
    const realParent = path.join(workspace.root, "real-parent");
    const symlinkParent = path.join(workspace.root, "linked-parent");
    const linkedWorkspace = {
      ...workspace,
      vaultPath: path.join(symlinkParent, "Agent-Notes")
    };

    try {
      mkdirSync(realParent, {
        recursive: true
      });
      symlinkSync(realParent, symlinkParent, "dir");
      writeInitState(linkedWorkspace);

      const result = await runInit(
        {
          resume: true,
          vaultPath: path.join(realParent, "Agent-Notes")
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      expect(result.status).toBe("resumed");
      expect(existsSync(path.join(realParent, "Agent-Notes", ".gitignore"))).toBe(true);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("resume 指定不符合 init-state 的 vault path 時拒絕", async () => {
    const workspace = makeWorkspace();

    try {
      writeInitState(workspace);

      await runInit(
        {
          resume: true,
          vaultPath: path.join(workspace.root, "Other-Agent-Notes")
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INIT_PARTIAL);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("既有其他 vault 的 init-state 不阻擋指定新 vault 初始化", async () => {
    const workspace = makeWorkspace();
    const otherVaultPath = path.join(workspace.root, "Other-Agent-Notes");

    try {
      writeInitState(workspace);

      const result = await runInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: otherVaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      expect(result.status).toBe("planned");
      expect(existsSync(path.join(otherVaultPath, ".gitignore"))).toBe(true);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("rollback 移除符合 init plan 的 partial files 與 init-state", async () => {
    const workspace = makeWorkspace();

    try {
      const writes = plannedInitWrites(workspace);
      writeInitState(workspace);
      writeFixtureFile(writes[0].targetPath, writes[0].content);
      writeFixtureFile(writes[1].targetPath, writes[1].content);
      writeFixtureFile(writes[2].targetPath, writes[2].content);

      const result = await runInit(
        {
          rollback: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );

      expect(result.status).toBe("rolled-back");
      expect(existsSync(writes[0].targetPath)).toBe(false);
      expect(existsSync(writes[1].targetPath)).toBe(false);
      expect(existsSync(writes[2].targetPath)).toBe(false);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("rollback lock 已存在時回 WRITE_CONFLICT 且不刪檔", async () => {
    const workspace = makeWorkspace();
    const writes = plannedInitWrites(workspace);

    try {
      writeInitState(workspace);
      writeFixtureFile(writes[0].targetPath, writes[0].content);
      writeFixtureFile(path.join(workspace.configHome, "agent-notes", "init.lock"), "existing");

      await runInit(
        {
          rollback: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      expect(readFileSync(writes[0].targetPath, "utf8")).toBe(writes[0].content);
      expect(readFileSync(path.join(workspace.configHome, "agent-notes", "init.lock"), "utf8")).toBe("existing");
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("rollback 拿到 lock 後若 init-state 已改變則拒絕使用 stale state 刪檔", async () => {
    const workspace = makeWorkspace();
    const writes = plannedInitWrites(workspace);
    const statePath = path.join(workspace.configHome, "agent-notes", "init-state.json");
    const staleState = initStateForWorkspace(workspace);
    const newerState = {
      ...staleState,
      createdAt: "2026-06-07T00:00:01.000Z",
      updatedAt: "2026-06-07T00:00:01.000Z"
    };
    const staleStateRaw = initStateStoreJson(staleState);
    const newerStateRaw = initStateStoreJson(newerState);

    vi.resetModules();

    try {
      writeFixtureFile(statePath, staleStateRaw);
      writeFixtureFile(writes[0].targetPath, writes[0].content);
      const fsActual = await vi.importActual<typeof import("node:fs")>("node:fs");
      let stateReadCount = 0;

      vi.doMock("node:fs", () => ({
        ...fsActual,
        readFileSync: (...args: Parameters<typeof fsActual.readFileSync>) => {
          const [targetPath] = args;

          if (String(targetPath) === statePath) {
            stateReadCount += 1;

            if (stateReadCount === 1) {
              fsActual.writeFileSync(statePath, newerStateRaw);

              return staleStateRaw;
            }
          }

          return fsActual.readFileSync(...args);
        }
      }));

      const { runInit: mockedRunInit } = await import("../src/commands/init.js");

      await mockedRunInit(
        {
          rollback: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expect((error as { readonly code?: ErrorCode }).code).toBe(ErrorCode.WRITE_CONFLICT);
      expect(readFileSync(writes[0].targetPath, "utf8")).toBe(writes[0].content);
      expect(readFileSync(statePath, "utf8")).toBe(newerStateRaw);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
      cleanup(workspace.root);
    }
  });

  it("rollback 拿到 lock 後若 firstProject state 已改變則拒絕使用 stale state 刪檔", async () => {
    const workspace = makeWorkspace();
    const statePath = path.join(workspace.configHome, "agent-notes", "init-state.json");
    const staleFirstProject = initStateFirstProject(workspace);
    const newerFirstProject = initStateFirstProject(workspace, {
      id: "renamed-repo",
      name: "Renamed Repo",
      repoId: "renamed-repo",
      notePath: "03-Projects/Renamed Repo",
      tags: ["renamed-repo"]
    });
    const writes = plannedInitWrites(workspace, staleFirstProject);
    const staleState = {
      ...initStateForWorkspace(workspace),
      files: writes.map((write) => ({
        targetPath: write.targetPath,
        contentHash: hashContent(write.content)
      })),
      firstProject: staleFirstProject,
      firstProjectSource: "explicit"
    };
    const newerState = {
      ...staleState,
      files: plannedInitWrites(workspace, newerFirstProject).map((write) => ({
        targetPath: write.targetPath,
        contentHash: hashContent(write.content)
      })),
      firstProject: newerFirstProject
    };
    const staleStateRaw = initStateStoreJson(staleState);
    const newerStateRaw = initStateStoreJson(newerState);

    vi.resetModules();

    try {
      writeFixtureFile(statePath, staleStateRaw);
      writeFixtureFile(writes[0].targetPath, writes[0].content);
      const fsActual = await vi.importActual<typeof import("node:fs")>("node:fs");
      let stateReadCount = 0;

      vi.doMock("node:fs", () => ({
        ...fsActual,
        readFileSync: (...args: Parameters<typeof fsActual.readFileSync>) => {
          const [targetPath] = args;

          if (String(targetPath) === statePath) {
            stateReadCount += 1;

            if (stateReadCount === 1) {
              fsActual.writeFileSync(statePath, newerStateRaw);

              return staleStateRaw;
            }
          }

          return fsActual.readFileSync(...args);
        }
      }));

      const { runInit: mockedRunInit } = await import("../src/commands/init.js");

      await mockedRunInit(
        {
          rollback: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expect((error as { readonly code?: ErrorCode }).code).toBe(ErrorCode.WRITE_CONFLICT);
      expect(readFileSync(writes[0].targetPath, "utf8")).toBe(writes[0].content);
      expect(readFileSync(statePath, "utf8")).toBe(newerStateRaw);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
      cleanup(workspace.root);
    }
  });

  it("fresh init lock 已存在時不留下假的 init-state", async () => {
    const workspace = makeWorkspace();

    try {
      writeFixtureFile(path.join(workspace.configHome, "agent-notes", "init.lock"), "existing");

      await runInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(false);
      expect(existsSync(path.join(workspace.vaultPath, ".gitignore"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("fresh init 取得 lock 後若同 key init-state 已出現則不覆寫", async () => {
    const workspace = makeWorkspace();
    const statePath = path.join(workspace.configHome, "agent-notes", "init-state.json");
    const existingStateRaw = initStateStoreJson(initStateForWorkspace(workspace));

    vi.resetModules();

    try {
      const fsActual = await vi.importActual<typeof import("node:fs")>("node:fs");
      let stateExistsChecks = 0;

      vi.doMock("node:fs", () => ({
        ...fsActual,
        existsSync: (...args: Parameters<typeof fsActual.existsSync>) => {
          const [targetPath] = args;

          if (String(targetPath) === statePath) {
            stateExistsChecks += 1;

            if (stateExistsChecks === 1) {
              fsActual.mkdirSync(path.dirname(statePath), {
                recursive: true
              });
              fsActual.writeFileSync(statePath, existingStateRaw);

              return false;
            }
          }

          return fsActual.existsSync(...args);
        }
      }));

      const { runInit: mockedRunInit } = await import("../src/commands/init.js");

      await mockedRunInit(
        {
          yes: true,
          lang: "zh-TW",
          vaultPath: workspace.vaultPath,
          integrations: false,
          project: false
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expect((error as { readonly code?: ErrorCode }).code).toBe(ErrorCode.WRITE_CONFLICT);
      expect(existsSync(path.join(workspace.vaultPath, ".gitignore"))).toBe(false);
      expect(readFileSync(statePath, "utf8")).toBe(existingStateRaw);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
      cleanup(workspace.root);
    }
  });

  it("rollback dry-run 顯示刪除摘要且不刪檔或移除 init-state", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];

    try {
      const writes = plannedInitWrites(workspace);
      writeInitState(workspace);
      writeFixtureFile(writes[0].targetPath, writes[0].content);
      writeFixtureFile(writes[1].targetPath, writes[1].content);

      const result = await runInitCommand(
        {
          rollback: true,
          dryRun: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home,
          stdout: (value) => output.push(value)
        }
      );

      expect(result.status).toBe("rolled-back");
      expect(readFileSync(writes[0].targetPath, "utf8")).toBe(writes[0].content);
      expect(readFileSync(writes[1].targetPath, "utf8")).toBe(writes[1].content);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(true);
      expect(output.join("")).toContain("filesToDelete: 2");
      expect(output.join("")).toContain("filesAlreadyMissing: 15");
      expect(output.join("")).toContain("modifiedConflicts: 0");
      expect(output.join("")).not.toContain("filesToCreate:");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("rollback 保留已被使用者修改的 partial file 並保留 init-state", async () => {
    const workspace = makeWorkspace();
    const writes = plannedInitWrites(workspace);

    try {
      writeInitState(workspace);
      writeFixtureFile(writes[0].targetPath, "user edit");
      writeFixtureFile(writes[1].targetPath, writes[1].content);

      await runInit(
        {
          rollback: true
        },
        {
          cwd: workspace.root,
          env: {
            HOME: workspace.home,
            XDG_CONFIG_HOME: workspace.configHome
          },
          homeDir: workspace.home
        }
      );
      throw new Error("expected runInit to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      expect(readFileSync(writes[0].targetPath, "utf8")).toBe("user edit");
      expect(readFileSync(writes[1].targetPath, "utf8")).toBe(writes[1].content);
      expect(existsSync(path.join(workspace.configHome, "agent-notes", "init-state.json"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });
});
