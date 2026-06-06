import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runInit, runInitCommand } from "../src/commands/init.js";
import { AgentNotesError, ErrorCode } from "../src/core/errors.js";

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
});
