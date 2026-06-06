import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentNotesError, ErrorCode } from "../src/core/errors.js";
import { executeWriteBatch, prepareWriteBatch } from "../src/core/writeSafety.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agent-notes-write-"));
}

function cleanup(directory: string): void {
  rmSync(directory, {
    recursive: true,
    force: true
  });
}

function writeFixtureFile(targetPath: string, content: string, flag?: string): void {
  mkdirSync(path.dirname(targetPath), {
    recursive: true
  });
  writeFileSync(targetPath, content, flag === undefined ? undefined : { flag });
}

function expectAgentNotesError(error: unknown, code: ErrorCode): void {
  expect(error).toBeInstanceOf(AgentNotesError);
  expect((error as AgentNotesError).code).toBe(code);
}

describe("write safety batch", () => {
  it("dry-run 不建立 lock、backup、temp file 或 target file", async () => {
    const workspace = makeWorkspace();
    const targetPath = path.join(workspace, "vault", "note.md");
    const lockFilePath = path.join(workspace, ".agent-notes", "locks", "capture.lock");
    const backupRootPath = path.join(workspace, ".agent-notes", "backups", "op");

    try {
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-dry-run",
        writes: [
          {
            targetPath,
            content: "hello"
          }
        ]
      });

      const result = await executeWriteBatch({
        batch,
        lockFilePath,
        backupRootPath,
        dryRun: true
      });

      expect(result.written).toHaveLength(0);
      expect(existsSync(targetPath)).toBe(false);
      expect(existsSync(lockFilePath)).toBe(false);
      expect(existsSync(backupRootPath)).toBe(false);
      expect(existsSync(path.join(path.dirname(targetPath), ".note.md.op-dry-run.tmp"))).toBe(false);
    } finally {
      cleanup(workspace);
    }
  });

  it("成功寫入後移除自己的 lock", async () => {
    const workspace = makeWorkspace();
    const targetPath = path.join(workspace, "vault", "note.md");
    const lockFilePath = path.join(workspace, ".agent-notes", "locks", "capture.lock");

    try {
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-success",
        writes: [
          {
            targetPath,
            content: "created"
          }
        ]
      });

      const result = await executeWriteBatch({
        batch,
        lockFilePath,
        backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-success")
      });

      expect(result.written).toEqual([targetPath]);
      expect(readFileSync(targetPath, "utf8")).toBe("created");
      expect(existsSync(lockFilePath)).toBe(false);
    } finally {
      cleanup(workspace);
    }
  });

  it("lock 已存在時回 WRITE_CONFLICT 且不寫入", async () => {
    const workspace = makeWorkspace();
    const targetPath = path.join(workspace, "vault", "note.md");
    const lockFilePath = path.join(workspace, ".agent-notes", "locks", "capture.lock");

    try {
      writeFixtureFile(lockFilePath, "existing", "wx");
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-lock",
        writes: [
          {
            targetPath,
            content: "created"
          }
        ]
      });

      try {
        await executeWriteBatch({
          batch,
          lockFilePath,
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-lock")
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      }

      expect(existsSync(targetPath)).toBe(false);
      expect(readFileSync(lockFilePath, "utf8")).toBe("existing");
    } finally {
      cleanup(workspace);
    }
  });

  it("修改既有檔案時建立 backup", async () => {
    const workspace = makeWorkspace();
    const targetPath = path.join(workspace, "vault", "note.md");
    const backupRootPath = path.join(workspace, ".agent-notes", "backups", "op-modify");

    try {
      writeFixtureFile(targetPath, "before");
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-modify",
        writes: [
          {
            targetPath,
            content: "after",
            backupKey: "note.md"
          }
        ]
      });

      await executeWriteBatch({
        batch,
        lockFilePath: path.join(workspace, ".agent-notes", "locks", "capture.lock"),
        backupRootPath
      });

      expect(readFileSync(targetPath, "utf8")).toBe("after");
      expect(readFileSync(path.join(backupRootPath, "note.md"), "utf8")).toBe("before");
    } finally {
      cleanup(workspace);
    }
  });

  it("寫入前 target hash 改變時回 WRITE_CONFLICT", async () => {
    const workspace = makeWorkspace();
    const targetPath = path.join(workspace, "vault", "note.md");

    try {
      writeFixtureFile(targetPath, "before");
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-conflict",
        writes: [
          {
            targetPath,
            content: "after"
          }
        ]
      });
      writeFixtureFile(targetPath, "changed");

      try {
        await executeWriteBatch({
          batch,
          lockFilePath: path.join(workspace, ".agent-notes", "locks", "capture.lock"),
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-conflict")
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      }

      expect(readFileSync(targetPath, "utf8")).toBe("changed");
    } finally {
      cleanup(workspace);
    }
  });

  it("後續寫入失敗時 rollback 已寫入檔案", async () => {
    const workspace = makeWorkspace();
    const firstPath = path.join(workspace, "vault", "first.md");
    const blockedParent = path.join(workspace, "vault", "blocked");
    const blockedTarget = path.join(blockedParent, "second.md");

    try {
      writeFixtureFile(firstPath, "before");
      writeFixtureFile(blockedParent, "not a directory");
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-rollback",
        writes: [
          {
            targetPath: firstPath,
            content: "after",
            backupKey: "first.md"
          },
          {
            targetPath: blockedTarget,
            content: "second"
          }
        ]
      });

      try {
        await executeWriteBatch({
          batch,
          lockFilePath: path.join(workspace, ".agent-notes", "locks", "capture.lock"),
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-rollback")
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      }

      expect(readFileSync(firstPath, "utf8")).toBe("before");
      expect(readFileSync(blockedParent, "utf8")).toBe("not a directory");
    } finally {
      cleanup(workspace);
    }
  });

  it("backup key 重複時回 WRITE_CONFLICT", () => {
    const workspace = makeWorkspace();

    try {
      const firstPath = path.join(workspace, "vault-a", "active-tasks.md");
      const secondPath = path.join(workspace, "vault-b", "active-tasks.md");
      writeFixtureFile(firstPath, "before-a");
      writeFixtureFile(secondPath, "before-b");

      try {
        prepareWriteBatch({
          command: "capture",
          operationId: "op-backup-collision",
          writes: [
            {
              targetPath: firstPath,
              content: "after-a",
              backupKey: "active-tasks.md"
            },
            {
              targetPath: secondPath,
              content: "after-b",
              backupKey: "active-tasks.md"
            }
          ]
        });
        throw new Error("expected prepareWriteBatch to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.WRITE_CONFLICT);
      }
    } finally {
      cleanup(workspace);
    }
  });

  it("backup key path traversal 時回 PATH_UNSAFE", () => {
    const workspace = makeWorkspace();

    try {
      const targetPath = path.join(workspace, "vault", "note.md");
      writeFixtureFile(targetPath, "before");

      try {
        prepareWriteBatch({
          command: "capture",
          operationId: "op-backup-traversal",
          writes: [
            {
              targetPath,
              content: "after",
              backupKey: "../outside.md"
            }
          ]
        });
        throw new Error("expected prepareWriteBatch to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
      }
    } finally {
      cleanup(workspace);
    }
  });

  it("public-safe gate 命中 private pattern 時回 PRIVATE_DATA_RISK 且不建立 lock 或 target", async () => {
    const workspace = makeWorkspace();
    const targetPath = path.join(workspace, "vault", "public-note.md");
    const lockFilePath = path.join(workspace, ".agent-notes", "locks", "capture.lock");

    try {
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-public-safe",
        publicSafeScanTargets: [targetPath],
        writes: [
          {
            targetPath,
            content: "repoPath: /Users/example/private-repo"
          }
        ]
      });

      try {
        await executeWriteBatch({
          batch,
          lockFilePath,
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-public-safe")
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PRIVATE_DATA_RISK);
      }

      expect(existsSync(targetPath)).toBe(false);
      expect(existsSync(lockFilePath)).toBe(false);
    } finally {
      cleanup(workspace);
    }
  });

  it("public-safe gate 也會掃描 skipped planned write", async () => {
    const workspace = makeWorkspace();
    const targetPath = path.join(workspace, "vault", "public-note.md");
    const lockFilePath = path.join(workspace, ".agent-notes", "locks", "capture.lock");
    const unsafeContent = "repoPath: /Users/example/private-repo";

    try {
      writeFixtureFile(targetPath, unsafeContent);
      const batch = prepareWriteBatch({
        command: "capture",
        operationId: "op-public-safe-skip",
        publicSafeScanTargets: [targetPath],
        writes: [
          {
            targetPath,
            content: unsafeContent
          }
        ]
      });

      expect(batch.plan.filesToSkip).toEqual([targetPath]);

      try {
        await executeWriteBatch({
          batch,
          lockFilePath,
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-public-safe-skip"),
          dryRun: true
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expectAgentNotesError(error, ErrorCode.PRIVATE_DATA_RISK);
      }

      expect(readFileSync(targetPath, "utf8")).toBe(unsafeContent);
      expect(existsSync(lockFilePath)).toBe(false);
    } finally {
      cleanup(workspace);
    }
  });

  it("operationId 含不安全字元時回 PATH_UNSAFE", () => {
    try {
      prepareWriteBatch({
        command: "capture",
        operationId: "../bad",
        writes: [
          {
            targetPath: "/tmp/agent-notes-unsafe.md",
            content: "unsafe"
          }
        ]
      });
      throw new Error("expected prepareWriteBatch to fail");
    } catch (error) {
      expectAgentNotesError(error, ErrorCode.PATH_UNSAFE);
    }
  });

  it("atomic rename 失敗時移除 temp file", async () => {
    const workspace = makeWorkspace();

    vi.resetModules();

    try {
      const fsPromises = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

      vi.doMock("node:fs/promises", () => ({
        ...fsPromises,
        rename: vi.fn(async () => {
          throw new Error("rename failed");
        })
      }));

      const writeSafety = await import("../src/core/writeSafety.js");
      const targetPath = path.join(workspace, "vault", "note.md");
      const batch = writeSafety.prepareWriteBatch({
        command: "capture",
        operationId: "op-rename-fails",
        writes: [
          {
            targetPath,
            content: "created"
          }
        ]
      });

      try {
        await writeSafety.executeWriteBatch({
          batch,
          lockFilePath: path.join(workspace, ".agent-notes", "locks", "capture.lock"),
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-rename-fails")
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expect((error as AgentNotesError).code).toBe(ErrorCode.WRITE_CONFLICT);
      }

      expect(existsSync(targetPath)).toBe(false);
      expect(existsSync(path.join(path.dirname(targetPath), ".note.md.op-rename-fails.tmp"))).toBe(false);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      cleanup(workspace);
    }
  });

  it("rollback 不刪除已被外部修改的新建檔案", async () => {
    const workspace = makeWorkspace();
    const firstPath = path.join(workspace, "vault", "created.md");
    const blockedParent = path.join(workspace, "vault", "blocked");
    const blockedTarget = path.join(blockedParent, "second.md");

    vi.resetModules();

    try {
      writeFixtureFile(blockedParent, "not a directory");
      const fsPromises = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

      vi.doMock("node:fs/promises", () => ({
        ...fsPromises,
        mkdir: vi.fn(async (...args: Parameters<typeof fsPromises.mkdir>) => {
          const [target] = args;

          if (String(target) === blockedParent) {
            await fsPromises.writeFile(firstPath, "user edit");
          }

          return fsPromises.mkdir(...args);
        })
      }));

      const writeSafety = await import("../src/core/writeSafety.js");
      const batch = writeSafety.prepareWriteBatch({
        command: "capture",
        operationId: "op-created-changed",
        writes: [
          {
            targetPath: firstPath,
            content: "created"
          },
          {
            targetPath: blockedTarget,
            content: "second"
          }
        ]
      });

      try {
        await writeSafety.executeWriteBatch({
          batch,
          lockFilePath: path.join(workspace, ".agent-notes", "locks", "capture.lock"),
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-created-changed")
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expect((error as AgentNotesError).code).toBe(ErrorCode.WRITE_CONFLICT);
      }

      expect(readFileSync(firstPath, "utf8")).toBe("user edit");
      expect(readFileSync(blockedParent, "utf8")).toBe("not a directory");
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      cleanup(workspace);
    }
  });

  it("新建檔案被外部修改時 rollback 仍會還原較早 modified file", async () => {
    const workspace = makeWorkspace();
    const modifiedPath = path.join(workspace, "vault", "modified.md");
    const createdPath = path.join(workspace, "vault", "created.md");
    const blockedParent = path.join(workspace, "vault", "blocked");
    const blockedTarget = path.join(blockedParent, "third.md");

    vi.resetModules();

    try {
      writeFixtureFile(modifiedPath, "before");
      writeFixtureFile(blockedParent, "not a directory");
      const fsPromises = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

      vi.doMock("node:fs/promises", () => ({
        ...fsPromises,
        mkdir: vi.fn(async (...args: Parameters<typeof fsPromises.mkdir>) => {
          const [target] = args;

          if (String(target) === blockedParent) {
            await fsPromises.writeFile(createdPath, "user edit");
          }

          return fsPromises.mkdir(...args);
        })
      }));

      const writeSafety = await import("../src/core/writeSafety.js");
      const batch = writeSafety.prepareWriteBatch({
        command: "capture",
        operationId: "op-rollback-continues",
        writes: [
          {
            targetPath: modifiedPath,
            content: "after",
            backupKey: "modified.md"
          },
          {
            targetPath: createdPath,
            content: "created"
          },
          {
            targetPath: blockedTarget,
            content: "third"
          }
        ]
      });

      try {
        await writeSafety.executeWriteBatch({
          batch,
          lockFilePath: path.join(workspace, ".agent-notes", "locks", "capture.lock"),
          backupRootPath: path.join(workspace, ".agent-notes", "backups", "op-rollback-continues")
        });
        throw new Error("expected executeWriteBatch to fail");
      } catch (error) {
        expect((error as AgentNotesError).code).toBe(ErrorCode.WRITE_CONFLICT);
        expect((error as Error).message).toContain("rollback incomplete");
      }

      expect(readFileSync(modifiedPath, "utf8")).toBe("before");
      expect(readFileSync(createdPath, "utf8")).toBe("user edit");
      expect(readFileSync(blockedParent, "utf8")).toBe("not a directory");
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      cleanup(workspace);
    }
  });
});
