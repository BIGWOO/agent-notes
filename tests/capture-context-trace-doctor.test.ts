import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCapture, runCaptureCommand } from "../src/commands/capture.js";
import { runContext } from "../src/commands/context.js";
import { runDoctor, runDoctorCommand } from "../src/commands/doctor.js";
import { runProjectAdd } from "../src/commands/project.js";
import { runTrace } from "../src/commands/trace.js";
import { AgentNotesError, ErrorCode } from "../src/core/errors.js";

function makeWorkspace(): {
  readonly configHome: string;
  readonly home: string;
  readonly repoPath: string;
  readonly root: string;
  readonly summaryPath: string;
  readonly vaultPath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "agent-notes-capture-"));

  return {
    configHome: path.join(root, "xdg-config"),
    home: path.join(root, "home"),
    repoPath: path.join(root, "example-repo"),
    root,
    summaryPath: path.join(root, "summary.md"),
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

function contextFor(workspace: ReturnType<typeof makeWorkspace>, operationId = "capture-test") {
  return {
    cwd: workspace.root,
    env: {
      HOME: workspace.home,
      XDG_CONFIG_HOME: workspace.configHome
    },
    homeDir: workspace.home,
    now: new Date("2026-06-07T01:02:03.000Z"),
    operationId
  };
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
  writeFixtureFile(path.join(workspace.vaultPath, "06-Templates", "summary-file.md"), summaryTemplate());
  writeFixtureFile(path.join(workspace.vaultPath, "06-Templates", "session-card.md"), "# Session Card\n");
  writeFixtureFile(path.join(workspace.vaultPath, "06-Templates", "project-README.md"), "# Project README\n");
  writeFixtureFile(path.join(workspace.vaultPath, "06-Templates", "active-tasks.md"), "# Active Tasks\n");
  writeFixtureFile(path.join(workspace.vaultPath, "06-Templates", "decision-log.md"), "# Decision Log\n");
  writeFixtureFile(path.join(workspace.vaultPath, "06-Templates", "pitfalls.md"), "# Pitfalls\n");

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

function summaryTemplate(): string {
  return [
    "## Summary",
    "",
    "Local-first CLI records agent work as Markdown notes.",
    "",
    "## Changes",
    "",
    "- Added capture pipeline.",
    "",
    "## Decisions",
    "",
    "- Use deterministic marker updates.",
    "",
    "## Validation",
    "",
    "- npm test",
    "",
    "## Next Steps",
    "",
    "- Finish trace command.",
    "",
    "## Handoff",
    ""
  ].join("\n");
}

async function addProject(workspace: ReturnType<typeof makeWorkspace>): Promise<void> {
  await runProjectAdd(
    {
      repo: workspace.repoPath
    },
    contextFor(workspace)
  );
}

function expectAgentNotesError(error: unknown, code: ErrorCode): void {
  expect(error).toBeInstanceOf(AgentNotesError);
  expect((error as AgentNotesError).code).toBe(code);
}

describe("capture, context, trace, doctor", () => {
  it("capture dry-run 不寫檔，且輸出不含本機絕對路徑", async () => {
    const workspace = makeWorkspace();
    const output: string[] = [];

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());

      const result = await runCaptureCommand(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath,
          tool: "codex",
          dryRun: true
        },
        {
          ...contextFor(workspace),
          stdout: (value) => output.push(value)
        }
      );
      const rendered = output.join("");

      expect(result.sessionNotePath).toBe("03-Projects/Example Repo/04-sessions/2026-06-07-ses-20260607-001.md");
      expect(result.result.written).toHaveLength(0);
      expect(existsSync(path.join(workspace.vaultPath, ".agent-notes", "source-index.json"))).toBe(false);
      expect(rendered).toContain("Agent Notes capture dry-run");
      expect(rendered).toContain("no files written");
      expect(rendered).toContain("03-Projects/Example Repo/04-sessions/2026-06-07-ses-20260607-001.md");
      expect(rendered).not.toContain(workspace.repoPath);
      expect(rendered).not.toContain(workspace.vaultPath);
      expect(rendered).not.toContain(workspace.summaryPath);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("capture project 寫入 session、source index、provenance 與 marker blocks，並可 context/trace/doctor", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());

      const result = await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath,
          tool: "codex"
        },
        contextFor(workspace)
      );
      const sessionPath = path.join(workspace.vaultPath, result.sessionNotePath ?? "");
      const readme = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "README.md"), "utf8");
      const decisions = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "decision-log.md"), "utf8");
      const tasks = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "active-tasks.md"), "utf8");
      const sourceIndex = JSON.parse(readFileSync(path.join(workspace.vaultPath, ".agent-notes", "source-index.json"), "utf8"));
      const provenance = readFileSync(path.join(workspace.vaultPath, ".agent-notes", "provenance.jsonl"), "utf8");

      expect(readFileSync(sessionPath, "utf8")).toContain("sessionId: \"SES-20260607-001\"");
      expect(readFileSync(sessionPath, "utf8")).not.toContain(workspace.summaryPath);
      expect(sourceIndex.sources.src_20260607_codex_001.localPath).toBe(workspace.summaryPath);
      expect(provenance).toContain("\"event\":\"session-created\"");
      expect(provenance).toContain("\"itemId\":\"DEC-0001\"");
      expect(readme).toContain("CTX-0001 | Local-first CLI records agent work as Markdown notes.");
      expect(decisions).toContain("DEC-0001 | Use deterministic marker updates.");
      expect(tasks).toContain("TASK-0001 | Finish trace command.");

      const contextResult = runContext(
        {
          repo: workspace.repoPath,
          maxChars: "4000"
        },
        contextFor(workspace)
      );

      expect(contextResult.output).toContain("# Agent Notes Context");
      expect(contextResult.output).toContain("## Trace Hints");
      expect(contextResult.output).toContain("agent-notes trace DEC-0001");

      const traceResult = runTrace("DEC-0001", contextFor(workspace));

      expect(traceResult.target).toEqual({
        id: "DEC-0001",
        type: "item"
      });
      expect(traceResult.sourceRefs).toEqual(["src_20260607_codex_001"]);

      const doctorResult = runDoctor({}, contextFor(workspace));

      expect(doctorResult.status).toBe("pass");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("capture default repo 未加入 project map 時寫入 inbox，不更新 project marker", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());

      const result = await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath,
          tool: "codex"
        },
        contextFor(workspace)
      );

      expect(result.route.scope).toBe("inbox");
      expect(result.sessionNotePath).toBe("01-Inbox/2026-06-07-ses-20260607-001.md");
      expect(result.touchedItems).toHaveLength(0);
      expect(existsSync(path.join(workspace.vaultPath, "01-Inbox", "2026-06-07-ses-20260607-001.md"))).toBe(true);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("scope project 但 repo 未加入 project map 時不 fallback inbox", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());

      try {
        await runCapture(
          {
            repo: workspace.repoPath,
            scope: "project",
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PROJECT_NOT_FOUND);
      }

      expect(existsSync(path.join(workspace.vaultPath, "01-Inbox"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("summary file 缺必要 heading 時不寫檔", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, "## Changes\n\n- missing Summary\n");

      try {
        await runCapture(
          {
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.INVALID_SUMMARY_FILE);
      }

      expect(existsSync(path.join(workspace.vaultPath, ".agent-notes", "source-index.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("summary parser 忽略 fenced code 裡的 heading", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      writeFixtureFile(
        workspace.summaryPath,
        [
          "## Summary",
          "",
          "Parser keeps machine headings outside fences.",
          "",
          "```md",
          "## Summary",
          "```",
          "",
          "## Changes",
          "",
          "## Decisions",
          "",
          "## Validation",
          "",
          "## Next Steps",
          "",
          "## Handoff",
          ""
        ].join("\n")
      );

      const result = await runCapture(
        {
          summaryFile: workspace.summaryPath,
          dryRun: true
        },
        contextFor(workspace)
      );

      expect(result.sessionId).toBe("SES-20260607-001");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("team-safe 命中本機路徑時 public-safe gate 阻擋且不寫檔", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate().replace("Local-first CLI", "Local path /Users/example/private"));

      try {
        await runCapture(
          {
            summaryFile: workspace.summaryPath,
            visibility: "team-safe"
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PRIVATE_DATA_RISK);
      }

      expect(existsSync(path.join(workspace.vaultPath, ".agent-notes", "source-index.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("capture 拒絕 symlink parent，避免寫到 vault 外", async () => {
    const workspace = makeWorkspace();
    const outsideDirectory = path.join(workspace.root, "outside-inbox");

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      mkdirSync(outsideDirectory);
      symlinkSync(outsideDirectory, path.join(workspace.vaultPath, "01-Inbox"));

      try {
        await runCapture(
          {
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
      }

      expect(existsSync(path.join(outsideDirectory, "2026-06-07-ses-20260607-001.md"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("capture 拒絕 .agent-notes symlink parent，避免 private store 寫到 vault 外", async () => {
    const workspace = makeWorkspace();
    const outsideDirectory = path.join(workspace.root, "outside-agent-notes");

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      mkdirSync(outsideDirectory);
      symlinkSync(outsideDirectory, path.join(workspace.vaultPath, ".agent-notes"));

      try {
        await runCapture(
          {
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
      }

      expect(existsSync(path.join(outsideDirectory, "source-index.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  for (const storeFileName of ["source-index.json", "provenance.jsonl"]) {
    it(`capture 拒絕 .agent-notes/${storeFileName} file symlink`, async () => {
      const workspace = makeWorkspace();
      const outsideFile = path.join(workspace.root, storeFileName);

      try {
        writeRuntime(workspace);
        writeFixtureFile(workspace.summaryPath, summaryTemplate());
        writeFixtureFile(outsideFile, storeFileName.endsWith(".json") ? "{\"version\":1,\"sources\":{}}\n" : "");
        mkdirSync(path.join(workspace.vaultPath, ".agent-notes"), {
          recursive: true
        });
        symlinkSync(outsideFile, path.join(workspace.vaultPath, ".agent-notes", storeFileName));

        try {
          await runCapture(
            {
              summaryFile: workspace.summaryPath
            },
            contextFor(workspace)
          );
          throw new Error("expected runCapture to fail");
        } catch (error) {
          expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
        }
      } finally {
        cleanup(workspace.root);
      }
    });
  }

  it("capture 拒絕 .agent-notes/locks symlink，避免 lock 寫到 vault 外", async () => {
    const workspace = makeWorkspace();
    const outsideDirectory = path.join(workspace.root, "outside-locks");

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      mkdirSync(path.join(workspace.vaultPath, ".agent-notes"), {
        recursive: true
      });
      mkdirSync(outsideDirectory);
      symlinkSync(outsideDirectory, path.join(workspace.vaultPath, ".agent-notes", "locks"));

      try {
        await runCapture(
          {
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
      }

      expect(existsSync(path.join(outsideDirectory, "capture.lock"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("capture 拒絕 .agent-notes/backups symlink，避免 backup 寫到 vault 外", async () => {
    const workspace = makeWorkspace();
    const outsideDirectory = path.join(workspace.root, "outside-backups");

    try {
      writeRuntime(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      mkdirSync(path.join(workspace.vaultPath, ".agent-notes"), {
        recursive: true
      });
      mkdirSync(outsideDirectory);
      symlinkSync(outsideDirectory, path.join(workspace.vaultPath, ".agent-notes", "backups"));

      try {
        await runCapture(
          {
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
      }

      expect(existsSync(path.join(outsideDirectory, "capture-test"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("include-raw 在 Phase 1 回 FEATURE_UNSUPPORTED", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);

      try {
        await runCapture(
          {
            includeRaw: true
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.FEATURE_UNSUPPORTED);
      }
    } finally {
      cleanup(workspace.root);
    }
  });

  it("重複 capture 相同 marker fingerprint 時保留 item id 並追加 sourceRef", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());

      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace, "capture-one")
      );
      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        {
          ...contextFor(workspace, "capture-two"),
          now: new Date("2026-06-07T02:03:04.000Z")
        }
      );

      const decisions = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "decision-log.md"), "utf8");

      expect(decisions.match(/DEC-0001 \| Use deterministic marker updates\./gu)).toHaveLength(1);
      expect(decisions).toContain("sourceRefs: src_20260607_codex_001, src_20260607_codex_002");
      expect(decisions).not.toContain("DEC-0002");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("capture 遇到缺 marker file 時回 MARKER_MISSING", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      rmSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "decision-log.md"));

      try {
        await runCapture(
          {
            repo: workspace.repoPath,
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.MARKER_MISSING);
      }

      expect(existsSync(path.join(workspace.vaultPath, ".agent-notes", "source-index.json"))).toBe(false);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("capture 遇到既有 generated item 缺 sourceRefs 時回 PROVENANCE_ORPHAN 且不補寫", async () => {
    const workspace = makeWorkspace();
    const decisionPath = path.join(workspace.vaultPath, "03-Projects", "Example Repo", "decision-log.md");

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      writeFixtureFile(
        decisionPath,
        [
          "# Decision Log",
          "",
          "Manual notes live outside generated blocks.",
          "",
          "<!-- agent-notes:start decision-log -->",
          "- DEC-0001 | Use deterministic marker updates.",
          "  - status: accepted",
          "<!-- agent-notes:end decision-log -->",
          ""
        ].join("\n")
      );

      try {
        await runCapture(
          {
            repo: workspace.repoPath,
            summaryFile: workspace.summaryPath
          },
          contextFor(workspace)
        );
        throw new Error("expected runCapture to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PROVENANCE_ORPHAN);
      }

      expect(readFileSync(decisionPath, "utf8")).not.toContain("sourceRefs:");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("marker updater 保留既有 item 的未知 metadata 與 detail lines", async () => {
    const workspace = makeWorkspace();
    const taskPath = path.join(workspace.vaultPath, "03-Projects", "Example Repo", "active-tasks.md");

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      writeFixtureFile(
        taskPath,
        [
          "# Active Tasks",
          "",
          "Manual notes live outside generated blocks.",
          "",
          "<!-- agent-notes:start active-tasks -->",
          "- TASK-0001 | Finish trace command.",
          "  - status: planned",
          "  - priority: high",
          "  - session: SES-20260607-000",
          "  - sourceRefs: src_20260607_codex_000",
          "  - note: keep manual detail",
          "<!-- agent-notes:end active-tasks -->",
          ""
        ].join("\n")
      );

      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace)
      );

      const tasks = readFileSync(taskPath, "utf8");

      expect(tasks).toContain("priority: high");
      expect(tasks).toContain("note: keep manual detail");
      expect(tasks).toContain("sourceRefs: src_20260607_codex_000, src_20260607_codex_001");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("summary parser 會從 top-level paragraph 產生 decision item 並略過不合格 title", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(
        workspace.summaryPath,
        [
          "## Summary",
          "",
          "Paragraph extraction is supported.",
          "",
          "## Changes",
          "",
          "## Decisions",
          "",
          "Use paragraph decision extraction.",
          "",
          "!!!",
          "",
          "## Validation",
          "",
          "## Next Steps",
          "",
          "## Handoff",
          ""
        ].join("\n")
      );

      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace)
      );

      const decisions = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "decision-log.md"), "utf8");

      expect(decisions).toContain("DEC-0001 | Use paragraph decision extraction.");
      expect(decisions).not.toContain("!!!");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("summary parser 不會從 fenced code 產生 summary/decision/task item", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(
        workspace.summaryPath,
        [
          "## Summary",
          "",
          "````md",
          "Code fence title must not become CTX.",
          "```",
          "Nested shorter fence must not close outer fence.",
          "```",
          "````ts",
          "Same-length info fence must not close outer fence.",
          "````",
          "Real summary title.",
          "",
          "## Changes",
          "",
          "## Decisions",
          "",
          "````md",
          "- Code fence decision must not be captured.",
          "```",
          "- Nested shorter fence decision must not be captured.",
          "```",
          "````ts",
          "- Same-length info fence decision must not be captured.",
          "````",
          "- Real decision.",
          "",
          "## Validation",
          "",
          "## Next Steps",
          "",
          "````md",
          "- Code fence task must not be captured.",
          "```",
          "- Nested shorter fence task must not be captured.",
          "```",
          "````ts",
          "- Same-length info fence task must not be captured.",
          "````",
          "- Real task.",
          "",
          "## Handoff",
          ""
        ].join("\n")
      );

      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace)
      );

      const readme = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "README.md"), "utf8");
      const decisions = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "decision-log.md"), "utf8");
      const tasks = readFileSync(path.join(workspace.vaultPath, "03-Projects", "Example Repo", "active-tasks.md"), "utf8");

      expect(readme).toContain("CTX-0001 | Real summary title.");
      expect(readme).not.toContain("Code fence title");
      expect(readme).not.toContain("Nested shorter fence");
      expect(readme).not.toContain("Same-length info fence");
      expect(decisions).toContain("DEC-0001 | Real decision.");
      expect(decisions).not.toContain("Code fence decision");
      expect(decisions).not.toContain("Nested shorter fence decision");
      expect(decisions).not.toContain("Same-length info fence decision");
      expect(tasks).toContain("TASK-0001 | Real task.");
      expect(tasks).not.toContain("Code fence task");
      expect(tasks).not.toContain("Nested shorter fence task");
      expect(tasks).not.toContain("Same-length info fence task");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("trace sourceRef 可回溯 session，missing item 回 TRACE_TARGET_NOT_FOUND", async () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace)
      );

      const sourceTrace = runTrace("src_20260607_codex_001", contextFor(workspace));

      expect(sourceTrace.target.type).toBe("source");
      expect(sourceTrace.sessions.map((session) => session.sessionId)).toEqual(["SES-20260607-001"]);

      try {
        runTrace("DEC-9999", contextFor(workspace));
        throw new Error("expected runTrace to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.TRACE_TARGET_NOT_FOUND);
      }
    } finally {
      cleanup(workspace.root);
    }
  });

  it("doctor provenance 會抓出 marker item 與 provenance log 斷鏈", async () => {
    const workspace = makeWorkspace();
    const decisionPath = path.join(workspace.vaultPath, "03-Projects", "Example Repo", "decision-log.md");

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace)
      );
      writeFixtureFile(decisionPath, readFileSync(decisionPath, "utf8").replace("DEC-0001", "DEC-9999"));

      const result = runDoctor(
        {
          check: "provenance"
        },
        contextFor(workspace)
      );

      expect(result.status).toBe("fail");
      expect(result.checks[0]?.code).toBe(ErrorCode.PROVENANCE_ORPHAN);
    } finally {
      cleanup(workspace.root);
    }
  });

  it("doctor provenance 會抓出 marker item 缺 provenance", async () => {
    const workspace = makeWorkspace();
    const taskPath = path.join(workspace.vaultPath, "03-Projects", "Example Repo", "active-tasks.md");

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace)
      );
      writeFixtureFile(
        taskPath,
        readFileSync(taskPath, "utf8").replace(
          "<!-- agent-notes:end active-tasks -->",
          [
            "- TASK-9999 | Manual orphan task.",
            "  - status: planned",
            "  - session: SES-20260607-001",
            "  - sourceRefs: src_20260607_codex_001",
            "<!-- agent-notes:end active-tasks -->"
          ].join("\n")
        )
      );

      const result = runDoctor(
        {
          check: "provenance"
        },
        contextFor(workspace)
      );

      expect(result.status).toBe("fail");
      expect(result.checks[0]?.code).toBe(ErrorCode.PROVENANCE_ORPHAN);
      expect(result.checks[0]?.message).toContain("missing provenance");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("doctor provenance 會抓出 marker item 缺 source index", async () => {
    const workspace = makeWorkspace();
    const taskPath = path.join(workspace.vaultPath, "03-Projects", "Example Repo", "active-tasks.md");

    try {
      writeRuntime(workspace);
      await addProject(workspace);
      writeFixtureFile(workspace.summaryPath, summaryTemplate());
      await runCapture(
        {
          repo: workspace.repoPath,
          summaryFile: workspace.summaryPath
        },
        contextFor(workspace)
      );
      writeFixtureFile(
        taskPath,
        readFileSync(taskPath, "utf8").replace(
          "<!-- agent-notes:end active-tasks -->",
          [
            "- TASK-9998 | Missing source task.",
            "  - status: planned",
            "  - session: SES-20260607-001",
            "  - sourceRefs: src_missing_001",
            "<!-- agent-notes:end active-tasks -->"
          ].join("\n")
        )
      );

      const result = runDoctor(
        {
          check: "provenance"
        },
        contextFor(workspace)
      );

      expect(result.status).toBe("fail");
      expect(result.checks[0]?.code).toBe(ErrorCode.PROVENANCE_ORPHAN);
      expect(result.checks[0]?.message).toContain("sourceRef missing");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("doctor vault 不可寫入時回 VAULT_NOT_WRITABLE", () => {
    const workspace = makeWorkspace();

    try {
      writeRuntime(workspace);
      chmodSync(workspace.vaultPath, 0o555);

      const result = runDoctor(
        {
          check: "vault"
        },
        contextFor(workspace)
      );

      expect(result.status).toBe("fail");
      expect(result.checks[0]?.code).toBe(ErrorCode.VAULT_NOT_WRITABLE);
    } finally {
      chmodSync(workspace.vaultPath, 0o755);
      cleanup(workspace.root);
    }
  });

  it("doctor public-safe 不會跟隨 vault 內 symlink 掃描 vault 外檔案", () => {
    const workspace = makeWorkspace();
    const outside = path.join(workspace.root, "outside.md");

    try {
      writeRuntime(workspace);
      writeFixtureFile(outside, "outside .env.local should not be scanned\n");
      mkdirSync(path.join(workspace.vaultPath, "01-Inbox"), {
        recursive: true
      });
      symlinkSync(outside, path.join(workspace.vaultPath, "01-Inbox", "linked.md"));

      const result = runDoctor(
        {
          check: "public-safe"
        },
        contextFor(workspace)
      );

      expect(result.status).toBe("pass");
    } finally {
      cleanup(workspace.root);
    }
  });

  it("doctor --check public-safe 回報 tracked Markdown private pattern", () => {
    const workspace = makeWorkspace();
    const output: string[] = [];

    try {
      writeRuntime(workspace);
      writeFixtureFile(path.join(workspace.vaultPath, "01-Inbox", "leak.md"), "Do not publish .env.local\n");

      try {
        runDoctorCommand(
          {
            check: "public-safe"
          },
          {
            ...contextFor(workspace),
            stdout: (value) => output.push(value)
          }
        );
        throw new Error("expected runDoctorCommand to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PRIVATE_DATA_RISK);
        expect(output.join("")).toContain("01-Inbox/leak.md");
        expect(output.join("")).not.toContain(".env.local");
      }
    } finally {
      cleanup(workspace.root);
    }
  });
});
