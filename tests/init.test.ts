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
});
