import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import { createCli } from "../src/cli/createCli.js";
import { AgentNotesError, ErrorCode, exitCodeFor } from "../src/core/errors.js";

async function parseCli(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createCli({
    exitOverride: true,
    version: "9.9.9-test",
    output: {
      writeOut: (value) => stdout.push(value),
      writeErr: (value) => stderr.push(value)
    }
  });

  try {
    await program.parseAsync(["node", "agent-notes", ...args], {
      from: "node"
    });

    return {
      exitCode: 0,
      stdout: stdout.join(""),
      stderr: stderr.join("")
    };
  } catch (error) {
    if (error instanceof CommanderError) {
      return {
        exitCode: error.exitCode,
        stdout: stdout.join(""),
        stderr: stderr.join("")
      };
    }

    if (error instanceof AgentNotesError) {
      return {
        exitCode: error.exitCode,
        stdout: stdout.join(""),
        stderr: `${error.code}: ${error.message}`
      };
    }

    throw error;
  }
}

describe("agent-notes CLI scaffold", () => {
  it("顯示版本", async () => {
    const result = await parseCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("9.9.9-test");
    expect(result.stderr).toBe("");
  });

  it("顯示 help 並列出 Phase 1 command skeleton", async () => {
    const result = await parseCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: agent-notes");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("capture");
    expect(result.stdout).toContain("doctor");
  });

  it("未實作 command 使用穩定錯誤碼", async () => {
    const result = await parseCli(["capture", "--dry-run"]);

    expect(result.exitCode).toBe(exitCodeFor(ErrorCode.FEATURE_UNSUPPORTED));
    expect(result.stderr).toContain(ErrorCode.FEATURE_UNSUPPORTED);
  });

  it("post-MVP command 使用 FEATURE_UNSUPPORTED 而不是 unknown command", async () => {
    const result = await parseCli(["rollup", "--daily"]);

    expect(result.exitCode).toBe(exitCodeFor(ErrorCode.FEATURE_UNSUPPORTED));
    expect(result.stderr).toContain(ErrorCode.FEATURE_UNSUPPORTED);
  });
});
