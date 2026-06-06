import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runProjectAdd,
  runProjectAddCommand,
  runProjectCheck,
  runProjectCheckCommand,
  runProjectListCommand
} from "../src/commands/project.js";
import { AgentNotesError, ErrorCode } from "../src/core/errors.js";

function makeWorkspace(): {
  readonly root: string;
  readonly configHome: string;
  readonly home: string;
  readonly vaultPath: string;
  readonly repoPath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "agent-notes-project-"));

  return {
    root,
    configHome: path.join(root, "xdg-config"),
    home: path.join(root, "home"),
    vaultPath: path.join(root, "Agent-Notes"),
    repoPath: path.join(root, "example-repo")
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

function writeRuntime(workspace: ReturnType<typeof makeWorkspace>): void {
  mkdirSync(workspace.vaultPath, {
    recursive: true
  });
  mkdirSync(workspace.repoPath, {
    recursive: true
  });
  writeFixtureFile(path.join(workspace.vaultPath, ".gitignore"), "private/\n.agent-notes/\n.DS_Store\n");
  writeFixtureFile(path.join(workspace.vaultPath, "00-Meta", "Systems", "agent-note-protocol.md"), "# Agent Notes Protocol\n");
  writeFixtureFile(path.join(workspace.vaultPath, "06-Templates", ".gitkeep"), "");

  const projectMapPath = path.join(workspace.configHome, "agent-notes", "project-map.json");

  writeFixtureFile(
    path.join(workspace.configHome, "agent-notes", "config.json"),
    `${JSON.stringify(
      {
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
        vaultPath: workspace.vaultPath,
        projects: []
      },
      null,
      2
    )}\n`
  );
}

function contextFor(workspace: ReturnType<typeof makeWorkspace>) {
  return {
    cwd: workspace.root,
    env: {
      HOME: workspace.home,
      XDG_CONFIG_HOME: workspace.configHome
    },
    homeDir: workspace.home
  };
}

function expectAgentNotesError(error: unknown, code: ErrorCode): void {
  expect(error).toBeInstanceOf(AgentNotesError);
  expect((error as AgentNotesError).code).toBe(code);
}

describe("project commands", () => {
  it("project add dry-run 不寫入且輸出不包含 repo 絕對路徑", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];

    try {
      writeRuntime(workspace);

      const result = await runProjectAddCommand(
        {
          repo: workspace.repoPath,
          dryRun: true
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );

      expect(result.status).toBe("planned");
      expect(result.result.written).toHaveLength(0);
      expect(result.batch.plan.filesToCreate).toHaveLength(4);
      expect(result.batch.plan.filesToModify).toHaveLength(1);
      expect(JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"))).toEqual({
        version: 1,
        vaultPath: workspace.vaultPath,
        projects: []
      });
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "README.md"))).toBe(false);
      expect(output.join("")).toContain("Agent Notes project add dry-run");
      expect(output.join("")).toContain("repo: example-repo#");
      expect(output.join("")).toContain("directory: 03-Projects/Example Repo");
      expect(output.join("")).toContain("03-Projects/Example Repo/README.md");
      expect(output.join("")).toContain("03-Projects/Example Repo/active-tasks.md");
      expect(output.join("")).not.toContain(workspace.repoPath);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project add 寫入 project map 與 context templates", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);

      const result = await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );

      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));
      const projectDirectory = path.join(workspace.vaultPath, "03-Projects", "Example Repo");

      expect(result.status).toBe("planned");
      expect(result.result.written).toHaveLength(5);
      expect(projectMap.projects).toHaveLength(1);
      expect(projectMap.projects[0]).toMatchObject({
        id: "example-repo",
        name: "Example Repo",
        repoId: "example-repo",
        repoPaths: result.entry.repoPaths,
        notePath: "03-Projects/Example Repo",
        visibility: "private"
      });
      expect(readFileSync(path.join(projectDirectory, "README.md"), "utf8")).toContain("# Example Repo");
      expect(readFileSync(path.join(projectDirectory, "active-tasks.md"), "utf8")).not.toContain(workspace.repoPath);
      expect(existsSync(path.join(workspace.vaultPath, ".agent-notes", "locks", "project-map.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project add 不覆寫既有 project context 檔案", async () => {
    const workspace = makeWorkspace();
    const existingReadmePath = path.join(workspace.vaultPath, "03-Projects", "Example Repo", "README.md");

    try {
      writeRuntime(workspace);
      writeFixtureFile(existingReadmePath, "# Manual Project\n\nkeep this\n");

      try {
        await runProjectAdd(
          {
            repo: workspace.repoPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runProjectAdd to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      }

      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(projectMap.projects).toHaveLength(0);
      expect(readFileSync(existingReadmePath, "utf8")).toBe("# Manual Project\n\nkeep this\n");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project add 對相同名稱產生唯一 notePath", async () => {
    const workspace = makeWorkspace();
    const secondRepoPath = path.join(workspace.root, "second-repo");

    try {
      writeRuntime(workspace);
      mkdirSync(secondRepoPath);

      const first = await runProjectAdd(
        {
          repo: workspace.repoPath,
          name: "Shared Project"
        },
        contextFor(workspace)
      );
      const second = await runProjectAdd(
        {
          repo: secondRepoPath,
          name: "Shared Project"
        },
        contextFor(workspace)
      );
      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(first.entry.notePath).toBe("03-Projects/Shared Project");
      expect(second.entry.notePath).toBe("03-Projects/Shared Project-2");
      expect(projectMap.projects.map((project: { notePath: string }) => project.notePath)).toEqual([
        "03-Projects/Shared Project",
        "03-Projects/Shared Project-2"
      ]);
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Shared Project", "README.md"))).toBe(true);
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Shared Project-2", "README.md"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project add 對已綁定 repo idempotent", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );

      const result = await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );
      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(result.status).toBe("existing");
      expect(result.result.written).toHaveLength(0);
      expect(projectMap.projects).toHaveLength(1);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project add 拒絕 project map vaultPath 與 local config 不一致", async () => {
    const workspace = makeWorkspace();
    const projectMapPath = path.join(workspace.configHome, "agent-notes", "project-map.json");
    const otherVaultPath = path.join(workspace.root, "Other-Vault");

    try {
      writeRuntime(workspace);
      writeFixtureFile(
        projectMapPath,
        `${JSON.stringify(
          {
            version: 1,
            vaultPath: otherVaultPath,
            projects: []
          },
          null,
          2
        )}\n`
      );

      try {
        await runProjectAdd(
          {
            repo: workspace.repoPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runProjectAdd to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PROJECT_MAP_INVALID);
      }

      expect(existsSync(path.join(otherVaultPath, ".agent-notes"))).toBe(false);
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "README.md"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project add 遇到既有 lock 時不寫入", async () => {
    const workspace = makeWorkspace();
    const lockFilePath = path.join(workspace.vaultPath, ".agent-notes", "locks", "project-map.lock");

    try {
      writeRuntime(workspace);
      writeFixtureFile(lockFilePath, '{"operationId":"other"}\n');

      try {
        await runProjectAdd(
          {
            repo: workspace.repoPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runProjectAdd to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      }

      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(projectMap.projects).toHaveLength(0);
      expect(existsSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "README.md"))).toBe(false);
      expect(readFileSync(lockFilePath, "utf8")).toBe('{"operationId":"other"}\n');
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project add 使用唯一 operationId 保留每次 project map backup", async () => {
    const workspace = makeWorkspace();
    const secondRepoPath = path.join(workspace.root, "second-repo");

    try {
      writeRuntime(workspace);
      mkdirSync(secondRepoPath);

      const first = await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );
      const second = await runProjectAdd(
        {
          repo: secondRepoPath
        },
        contextFor(workspace)
      );

      expect(first.batch.plan.operationId).not.toBe(second.batch.plan.operationId);
      expect(existsSync(path.join(workspace.vaultPath, ".agent-notes", "backups", first.batch.plan.operationId, "project-map.json"))).toBe(true);
      expect(existsSync(path.join(workspace.vaultPath, ".agent-notes", "backups", second.batch.plan.operationId, "project-map.json"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project list 可標示 matched project 且不輸出 repo 絕對路徑", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];

    try {
      writeRuntime(workspace);
      await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );

      const result = runProjectListCommand(
        {
          repo: workspace.repoPath
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );

      expect(result.matchedProjectId).toBe("example-repo");
      expect(output.join("")).toContain("matched: example-repo");
      expect(output.join("")).toContain("repo: example-repo#");
      expect(output.join("")).not.toContain(workspace.repoPath);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project list 對未匹配 repo 顯示 add 提示且不輸出絕對路徑", async () => {
    const workspace = makeWorkspace();
    const unknownRepoPath = path.join(workspace.root, "unknown-repo");
    const output: string[] = [];

    try {
      writeRuntime(workspace);
      mkdirSync(unknownRepoPath);
      await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );

      const result = runProjectListCommand(
        {
          repo: unknownRepoPath
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );

      expect(result.matchedProjectId).toBeUndefined();
      expect(output.join("")).toContain("matched: none");
      expect(output.join("")).toContain('next: cd to that repo, then run agent-notes project add --repo "$PWD"');
      expect(output.join("")).not.toContain(unknownRepoPath);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project list 在 empty project map 仍對 --repo 使用安全提示", () => {
    const workspace = makeWorkspace();
    const unknownRepoPath = path.join(workspace.root, "unknown-repo");
    const output: string[] = [];

    try {
      writeRuntime(workspace);
      mkdirSync(unknownRepoPath);

      const result = runProjectListCommand(
        {
          repo: unknownRepoPath
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );

      expect(result.projects).toHaveLength(0);
      expect(result.matchedProjectId).toBeUndefined();
      expect(output.join("")).toContain("empty: true");
      expect(output.join("")).toContain("matched: none");
      expect(output.join("")).toContain('next: cd to that repo, then run agent-notes project add --repo "$PWD"');
      expect(output.join("")).not.toContain('next: agent-notes project add --repo "$PWD"\n');
      expect(output.join("")).not.toContain(unknownRepoPath);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project check 對未知 repo 回 PROJECT_NOT_FOUND 且不自動建立", async () => {
    const workspace = makeWorkspace();
    const unknownRepoPath = path.join(workspace.root, "unknown-repo");

    try {
      writeRuntime(workspace);
      mkdirSync(unknownRepoPath);

      await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );

      try {
        runProjectCheck(
          {
            repo: unknownRepoPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runProjectCheck to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PROJECT_NOT_FOUND);
      }

      const projectMap = JSON.parse(readFileSync(path.join(workspace.configHome, "agent-notes", "project-map.json"), "utf8"));

      expect(projectMap.projects).toHaveLength(1);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("project check 對已知 repo 輸出 project metadata", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await runProjectAdd(
        {
          repo: workspace.repoPath
        },
        contextFor(workspace)
      );

      const output: string[] = [];
      const result = runProjectCheckCommand(
        {
          repo: workspace.repoPath
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );

      expect(result.project.id).toBe("example-repo");
      expect(result.project.notePath).toBe("03-Projects/Example Repo");
      expect(output.join("")).toContain("repo: example-repo#");
      expect(output.join("")).not.toContain(workspace.repoPath);
    } finally {
      cleanup(workspace.root);
    }
  });
});
