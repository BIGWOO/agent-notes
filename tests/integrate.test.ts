import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runIntegrateClaudeCode,
  runIntegrateClaudeCodeCommand,
  runIntegrateCodex,
  runIntegrateCodexCommand,
  runIntegrateList,
  runIntegrateListCommand,
  runIntegrateOpenClaw,
  runIntegrateOpenClawCommand
} from "../src/commands/integrate.js";
import { AgentNotesError, ErrorCode } from "../src/core/errors.js";

function makeWorkspace(): {
  readonly root: string;
  readonly codexHome: string;
  readonly home: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "agent-notes-integrate-"));

  return {
    root,
    codexHome: path.join(root, "codex-home"),
    home: path.join(root, "home")
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

function writeCodexConfig(workspace: ReturnType<typeof makeWorkspace>, value: Record<string, unknown>): string {
  const configPath = path.join(workspace.codexHome, "config.json");

  writeFixtureFile(configPath, `${JSON.stringify(value, null, 2)}\n`);

  return configPath;
}

function contextFor(workspace: ReturnType<typeof makeWorkspace>, operationId = "integrate-codex-test") {
  return {
    cwd: workspace.root,
    env: {
      CODEX_HOME: workspace.codexHome,
      HOME: workspace.home
    },
    homeDir: workspace.home,
    operationId
  };
}

function expectAgentNotesError(error: unknown, code: ErrorCode): void {
  expect(error).toBeInstanceOf(AgentNotesError);
  expect((error as AgentNotesError).code).toBe(code);
}

describe("integrate command", () => {
  it("integrate --list 不需要 Agent Notes config 且不寫檔", () => {
    const workspace = makeWorkspace();
    const output: string[] = [];

    try {
      const result = runIntegrateListCommand({
        ...contextFor(workspace),
        stdout: (value) => output.push(value)
      });

      expect(result.integrations).toEqual([
        {
          agent: "codex",
          status: "not-found",
          message: "config not found"
        },
        {
          agent: "claude-code",
          status: "dry-run-only",
          message: "dry-run skeleton available; apply unsupported"
        },
        {
          agent: "openclaw",
          status: "dry-run-only",
          message: "dry-run skeleton available; apply unsupported"
        }
      ]);
      expect(output.join("")).toContain("codex: not-found");
      expect(output.join("")).toContain("claude-code: dry-run-only");
      expect(output.join("")).toContain("openclaw: dry-run-only");
      expect(existsSync(workspace.codexHome)).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("integrate --list 可辨識 supported Codex config", () => {
    const workspace = makeWorkspace();

    try {
      writeCodexConfig(workspace, {
        model: "gpt-test",
        hooks: {
          stop: []
        }
      });

      const result = runIntegrateList(contextFor(workspace));

      expect(result.integrations[0]).toMatchObject({
        agent: "codex",
        status: "supported"
      });
    } finally {
      cleanup(workspace.root);
    }
  });

  it("integrate --list 可從 process.env.CODEX_HOME 偵測 Codex config", () => {
    const workspace = makeWorkspace();
    const originalCodexHome = process.env.CODEX_HOME;

    try {
      writeCodexConfig(workspace, {
        model: "gpt-test",
        hooks: {
          stop: []
        }
      });
      process.env.CODEX_HOME = workspace.codexHome;

      const result = runIntegrateList();

      expect(result.integrations[0]).toMatchObject({
        agent: "codex",
        status: "supported"
      });
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }

      cleanup(workspace.root);
    }
  });

  it("codex dry-run recognized config 不寫檔且輸出不含本機 config 絕對路徑", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: ["existing command"]
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      const result = await runIntegrateCodexCommand(
        {
          dryRun: true
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );
      const rendered = output.join("");

      expect(result.mode).toBe("dry-run");
      expect(result.batch.plan.filesToModify).toHaveLength(1);
      expect(result.batch.plan.filesToCreate).toHaveLength(0);
      expect(result.hookCommand).toContain("agent-notes capture --tool codex");
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(rendered).toContain("codex: dry-run");
      expect(rendered).toContain("config: config.json#");
      expect(rendered).toContain("no files written");
      expect(rendered).not.toContain(workspace.codexHome);
      expect(rendered).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 使用絕對 binary 時輸出只顯示 safe summary", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];
    const binaryPath = path.join(workspace.home, "bin", "agent-notes");
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      const result = await runIntegrateCodexCommand(
        {
          dryRun: true,
          binary: binaryPath
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );
      const rendered = output.join("");

      expect(result.stableBinary).toBe(binaryPath);
      expect(result.hookCommand).toContain(binaryPath);
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(rendered).toContain("binary: agent-notes#");
      expect(rendered).toContain("hookCommand: agent-notes#");
      expect(rendered).not.toContain(binaryPath);
      expect(rendered).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 找不到 config 時回 INTEGRATION_NOT_FOUND", async () => {
    const workspace = makeWorkspace();

    try {
      await runIntegrateCodex(
        {
          dryRun: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_NOT_FOUND);
      expect(existsSync(workspace.codexHome)).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 未知 config shape 時回 INTEGRATION_UNSUPPORTED 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: "not-supported"
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          dryRun: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_UNSUPPORTED);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 對缺少 fixture root marker 的 JSON object 回 INTEGRATION_UNSUPPORTED", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          dryRun: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_UNSUPPORTED);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 對任意 extra root key 回 INTEGRATION_UNSUPPORTED", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      custom: {
        keep: true
      },
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          dryRun: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_UNSUPPORTED);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 未知 config shape 時輸出 manual instructions", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];

    writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: "not-supported"
      }
    });

    try {
      await runIntegrateCodexCommand(
        {
          dryRun: true
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );
      throw new Error("expected runIntegrateCodexCommand to fail");
    } catch (error) {
      const rendered = output.join("");

      expectAgentNotesError(error, ErrorCode.INTEGRATION_UNSUPPORTED);
      expect(rendered).toContain("manualInstructions:");
      expect(rendered).toContain("no files written");
      expect(rendered).not.toContain(workspace.codexHome);
      expect(rendered).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 拒絕 npx ephemeral binary", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          dryRun: true,
          binary: "npx agent-notes"
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 拒絕 npm exec ephemeral binary", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          dryRun: true,
          binary: "npm exec agent-notes"
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  for (const binary of ["pnpm dlx agent-notes", "yarn dlx agent-notes", "bunx agent-notes"]) {
    it(`codex dry-run 拒絕 ${binary} ephemeral binary`, async () => {
      const workspace = makeWorkspace();
      const configPath = writeCodexConfig(workspace, {
        model: "gpt-test",
        hooks: {
          stop: []
        }
      });
      const before = readFileSync(configPath, "utf8");

      try {
        await runIntegrateCodex(
          {
            dryRun: true,
            binary
          },
          contextFor(workspace)
        );
        throw new Error("expected runIntegrateCodex to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
        expect(readFileSync(configPath, "utf8")).toBe(before);
      } finally {
        cleanup(workspace.root);
      }
    });
  }

  it("codex dry-run 拒絕含 shell metacharacters 的 binary", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          dryRun: true,
          binary: "/usr/local/bin/agent-notes;rm"
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex dry-run 拒絕相對 binary path", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          dryRun: true,
          binary: "./agent-notes"
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply 未指定絕對 --binary 時回 INTEGRATION_BINARY_UNSTABLE 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          apply: true,
          yes: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply 未提供 --yes 時回 NON_INTERACTIVE_REQUIRED 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateCodex(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes"
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.NON_INTERACTIVE_REQUIRED);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply 建立 backup、寫入 hook 並保留 unrelated config", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      approval_policy: "never",
      hooks: {
        stop: ["existing command"]
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      const result = await runIntegrateCodex(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        contextFor(workspace)
      );
      const updated = JSON.parse(readFileSync(configPath, "utf8")) as {
        readonly approval_policy?: string;
        readonly hooks?: { readonly stop?: readonly string[] };
      };
      const backupPath = path.join(workspace.codexHome, "backups", "agent-notes", "integrate-codex-test", "config.json");

      expect(result.mode).toBe("applied");
      expect(result.result.written).toEqual([configPath]);
      expect(result.batch.plan.filesToModify).toEqual([configPath]);
      expect(updated.approval_policy).toBe("never");
      expect(updated.hooks?.stop).toEqual([
        "existing command",
        '/usr/local/bin/agent-notes capture --tool codex --scope inbox --summary-file "$AGENT_NOTES_SUMMARY_FILE"'
      ]);
      expect(readFileSync(backupPath, "utf8")).toBe(before);
      expect(existsSync(path.join(workspace.codexHome, ".agent-notes", "integrate-codex.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply backup 失敗時回 BACKUP_FAILED 且原 config 不變", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    writeFixtureFile(path.join(workspace.codexHome, "backups", "agent-notes", "integrate-codex-test"), "not a directory");

    try {
      await runIntegrateCodex(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.BACKUP_FAILED);
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(existsSync(path.join(workspace.codexHome, ".agent-notes", "integrate-codex.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply lock 已存在時回 WRITE_CONFLICT 且不寫檔不建立 backup", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");
    const lockPath = path.join(workspace.codexHome, ".agent-notes", "integrate-codex.lock");

    writeFixtureFile(
      lockPath,
      `${JSON.stringify({
        operationId: "other-operation",
        command: "integrate-codex"
      })}\n`
    );

    try {
      await runIntegrateCodex(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(existsSync(path.join(workspace.codexHome, "backups", "agent-notes", "integrate-codex-test"))).toBe(false);
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply 寫入前 config hash 改變時回 WRITE_CONFLICT 且不覆蓋外部變更", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const externalChange = `${JSON.stringify(
      {
        model: "gpt-test",
        hooks: {
          stop: ["external command"]
        }
      },
      null,
      2
    )}\n`;

    try {
      await runIntegrateCodex(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        {
          ...contextFor(workspace),
          beforeApply: () => {
            writeFileSync(configPath, externalChange);
          }
        }
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      expect(readFileSync(configPath, "utf8")).toBe(externalChange);
      expect(existsSync(path.join(workspace.codexHome, "backups", "agent-notes", "integrate-codex-test"))).toBe(false);
      expect(existsSync(path.join(workspace.codexHome, ".agent-notes", "integrate-codex.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply 寫入後失敗時 rollback 還原 config 並保留 backup", async () => {
    const workspace = makeWorkspace();
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");
    let sawAppliedConfig = false;

    try {
      await runIntegrateCodex(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        {
          ...contextFor(workspace),
          afterApply: () => {
            const currentConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
              readonly hooks?: { readonly stop?: readonly string[] };
            };

            sawAppliedConfig =
              currentConfig.hooks?.stop?.includes(
                '/usr/local/bin/agent-notes capture --tool codex --scope inbox --summary-file "$AGENT_NOTES_SUMMARY_FILE"'
              ) === true;

            throw new AgentNotesError(ErrorCode.INTEGRATION_APPLY_FAILED, "simulated post-write failure");
          }
        }
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      const backupPath = path.join(workspace.codexHome, "backups", "agent-notes", "integrate-codex-test", "config.json");

      expectAgentNotesError(error, ErrorCode.INTEGRATION_APPLY_FAILED);
      expect(sawAppliedConfig).toBe(true);
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(readFileSync(backupPath, "utf8")).toBe(before);
      expect(existsSync(path.join(workspace.codexHome, ".agent-notes", "integrate-codex.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("codex apply 拒絕 CODEX_HOME/backups symlink，避免 backup 寫到外部目錄", async () => {
    const workspace = makeWorkspace();
    const outsideDirectory = path.join(workspace.root, "outside-backups");
    const configPath = writeCodexConfig(workspace, {
      model: "gpt-test",
      hooks: {
        stop: []
      }
    });
    const before = readFileSync(configPath, "utf8");

    try {
      mkdirSync(outsideDirectory);
      symlinkSync(outsideDirectory, path.join(workspace.codexHome, "backups"));

      await runIntegrateCodex(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateCodex to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(existsSync(path.join(outsideDirectory, "agent-notes"))).toBe(false);
      expect(existsSync(path.join(workspace.codexHome, ".agent-notes", "integrate-codex.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("claude-code dry-run 不寫檔且輸出不含本機 config 絕對路徑", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];
    const claudeHome = path.join(workspace.root, "claude-home");
    const settingsPath = path.join(claudeHome, "settings.json");

    writeFixtureFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {}
        },
        null,
        2
      )}\n`
    );
    const before = readFileSync(settingsPath, "utf8");

    try {
      const result = await runIntegrateClaudeCodeCommand(
        {
          dryRun: true
        },
        {
          ...contextFor(workspace),
          env: {
            ...contextFor(workspace).env,
            CLAUDE_HOME: claudeHome
          },
          stdout: (value) => output.push(value)
        }
      );
      const rendered = output.join("");

      expect(result.mode).toBe("dry-run");
      expect(result.agent).toBe("claude-code");
      expect(result.checkedConfigCandidates).toEqual(["settings.json", "settings.local.json"]);
      expect(result.filesToModify).toBe(0);
      expect(result.hookCommand).toContain("agent-notes capture --tool claude-code");
      expect(readFileSync(settingsPath, "utf8")).toBe(before);
      expect(rendered).toContain("claude-code: dry-run");
      expect(rendered).toContain("detectedConfig: settings.json#");
      expect(rendered).toContain("checkedConfigCandidates: settings.json,settings.local.json");
      expect(rendered).toContain("hint: config root source: CLAUDE_HOME");
      expect(rendered).toContain("no files written");
      expect(rendered).not.toContain(claudeHome);
      expect(rendered).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("claude-code dry-run 找不到 config 時仍只輸出 hints 且不建立 config root", async () => {
    const workspace = makeWorkspace();

    try {
      const result = await runIntegrateClaudeCode(
        {
          dryRun: true
        },
        contextFor(workspace)
      );

      expect(result.detectionSummary).toBe("not detected");
      expect(result.checkedConfigCandidates).toEqual(["settings.json", "settings.local.json"]);
      expect(result.filesToModify).toBe(0);
      expect(result.filesToBackup).toBe(0);
      expect(existsSync(path.join(workspace.home, ".claude"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("claude-code dry-run 使用絕對 binary 時輸出只顯示 safe summary", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];
    const binaryPath = path.join(workspace.home, "bin", "agent-notes");

    try {
      const result = await runIntegrateClaudeCodeCommand(
        {
          dryRun: true,
          binary: binaryPath
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );
      const rendered = output.join("");

      expect(result.stableBinary).toBe(binaryPath);
      expect(result.hookCommand).toContain(binaryPath);
      expect(rendered).toContain("binary: agent-notes#");
      expect(rendered).toContain("hookCommand: agent-notes#");
      expect(rendered).not.toContain(binaryPath);
      expect(rendered).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("claude-code dry-run 使用 isolated context.env 時不讀取 process.env.CLAUDE_HOME", async () => {
    const workspace = makeWorkspace();
    const originalClaudeHome = process.env.CLAUDE_HOME;
    const processClaudeHome = path.join(workspace.root, "process-claude-home");

    writeFixtureFile(path.join(processClaudeHome, "settings.json"), "{}\n");

    try {
      process.env.CLAUDE_HOME = processClaudeHome;

      const result = await runIntegrateClaudeCode(
        {
          dryRun: true
        },
        contextFor(workspace)
      );

      expect(result.detectionSummary).toBe("not detected");
    } finally {
      if (originalClaudeHome === undefined) {
        delete process.env.CLAUDE_HOME;
      } else {
        process.env.CLAUDE_HOME = originalClaudeHome;
      }

      cleanup(workspace.root);
    }
  });

  it("claude-code apply 回 INTEGRATION_UNSUPPORTED 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const claudeHome = path.join(workspace.root, "claude-home");
    const settingsPath = path.join(claudeHome, "settings.json");

    writeFixtureFile(settingsPath, "{}\n");
    const before = readFileSync(settingsPath, "utf8");

    try {
      await runIntegrateClaudeCode(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        {
          ...contextFor(workspace),
          env: {
            ...contextFor(workspace).env,
            CLAUDE_HOME: claudeHome
          }
        }
      );
      throw new Error("expected runIntegrateClaudeCode to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_UNSUPPORTED);
      expect(readFileSync(settingsPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("claude-code dry-run 拒絕 npx ephemeral binary", async () => {
    const workspace = makeWorkspace();

    try {
      await runIntegrateClaudeCode(
        {
          dryRun: true,
          binary: "npx agent-notes"
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateClaudeCode to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
      expect(existsSync(path.join(workspace.home, ".claude"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("openclaw dry-run 不寫檔且輸出不含本機 config 絕對路徑", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];
    const openClawHome = path.join(workspace.root, "openclaw-home");
    const configPath = path.join(openClawHome, "workflows.json");

    writeFixtureFile(
      configPath,
      `${JSON.stringify(
        {
          workflows: []
        },
        null,
        2
      )}\n`
    );
    const before = readFileSync(configPath, "utf8");

    try {
      const result = await runIntegrateOpenClawCommand(
        {
          dryRun: true
        },
        {
          ...contextFor(workspace),
          env: {
            ...contextFor(workspace).env,
            OPENCLAW_HOME: openClawHome
          },
          stdout: (value) => output.push(value)
        }
      );
      const rendered = output.join("");

      expect(result.mode).toBe("dry-run");
      expect(result.agent).toBe("openclaw");
      expect(result.checkedConfigCandidates).toEqual(["config.json", "openclaw.json", "workflows.json"]);
      expect(result.filesToModify).toBe(0);
      expect(result.hookCommand).toContain("agent-notes capture --tool openclaw");
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(rendered).toContain("openclaw: dry-run");
      expect(rendered).toContain("detectedConfig: workflows.json#");
      expect(rendered).toContain("checkedConfigCandidates: config.json,openclaw.json,workflows.json");
      expect(rendered).toContain("hint: config root source: OPENCLAW_HOME");
      expect(rendered).toContain("no files written");
      expect(rendered).not.toContain(openClawHome);
      expect(rendered).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("openclaw dry-run 使用絕對 binary 時輸出只顯示 safe summary", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];
    const binaryPath = path.join(workspace.home, "bin", "agent-notes");

    try {
      const result = await runIntegrateOpenClawCommand(
        {
          dryRun: true,
          binary: binaryPath
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );
      const rendered = output.join("");

      expect(result.stableBinary).toBe(binaryPath);
      expect(result.hookCommand).toContain(binaryPath);
      expect(rendered).toContain("binary: agent-notes#");
      expect(rendered).toContain("hookCommand: agent-notes#");
      expect(rendered).not.toContain(binaryPath);
      expect(rendered).not.toContain(workspace.home);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("openclaw dry-run 找不到 config 時仍只輸出 hints 且不建立 config root", async () => {
    const workspace = makeWorkspace();

    try {
      const result = await runIntegrateOpenClaw(
        {
          dryRun: true
        },
        contextFor(workspace)
      );

      expect(result.detectionSummary).toBe("not detected");
      expect(result.checkedConfigCandidates).toEqual(["config.json", "openclaw.json", "workflows.json"]);
      expect(result.filesToModify).toBe(0);
      expect(result.filesToBackup).toBe(0);
      expect(existsSync(path.join(workspace.home, ".openclaw"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("openclaw dry-run 使用 isolated context.env 時不讀取 process.env.OPENCLAW_HOME", async () => {
    const workspace = makeWorkspace();
    const originalOpenClawHome = process.env.OPENCLAW_HOME;
    const processOpenClawHome = path.join(workspace.root, "process-openclaw-home");

    writeFixtureFile(path.join(processOpenClawHome, "config.json"), "{}\n");

    try {
      process.env.OPENCLAW_HOME = processOpenClawHome;

      const result = await runIntegrateOpenClaw(
        {
          dryRun: true
        },
        contextFor(workspace)
      );

      expect(result.detectionSummary).toBe("not detected");
    } finally {
      if (originalOpenClawHome === undefined) {
        delete process.env.OPENCLAW_HOME;
      } else {
        process.env.OPENCLAW_HOME = originalOpenClawHome;
      }

      cleanup(workspace.root);
    }
  });

  it("openclaw apply 回 INTEGRATION_UNSUPPORTED 且不寫檔", async () => {
    const workspace = makeWorkspace();
    const openClawHome = path.join(workspace.root, "openclaw-home");
    const configPath = path.join(openClawHome, "config.json");

    writeFixtureFile(configPath, "{}\n");
    const before = readFileSync(configPath, "utf8");

    try {
      await runIntegrateOpenClaw(
        {
          apply: true,
          binary: "/usr/local/bin/agent-notes",
          yes: true
        },
        {
          ...contextFor(workspace),
          env: {
            ...contextFor(workspace).env,
            OPENCLAW_HOME: openClawHome
          }
        }
      );
      throw new Error("expected runIntegrateOpenClaw to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_UNSUPPORTED);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("openclaw dry-run 拒絕 npx ephemeral binary", async () => {
    const workspace = makeWorkspace();

    try {
      await runIntegrateOpenClaw(
        {
          dryRun: true,
          binary: "npx agent-notes"
        },
        contextFor(workspace)
      );
      throw new Error("expected runIntegrateOpenClaw to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.INTEGRATION_BINARY_UNSTABLE);
      expect(existsSync(path.join(workspace.home, ".openclaw"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });
});
