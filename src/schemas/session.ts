import { z } from "zod";
import { ErrorCode } from "../core/errors.js";
import {
  dateOnlySchema,
  isoDateTimeSchema,
  schemaVersionOne,
  scopeSchema,
  sourceRefSchema,
  slugSchema,
  visibilitySchema
} from "./common.js";
import { parseSchema } from "./parse.js";

const forbiddenTrackedFrontmatterKeys = [
  "repoPath",
  "vaultPath",
  "projectMapPath",
  "sourceFilePath",
  "homePath"
] as const;

const blockedTrackedStringPatterns = [
  /^\/(?:Users|home|tmp)(\/|$)/u,
  /^[A-Za-z]:\//u,
  /^\/\//u,
  /^\$HOME(\/|$)/u,
  /^\$\{HOME\}(\/|$)/u,
  /^~(\/|$)/u
] as const;

const sourceSchema = z
  .object({
    kind: z.literal("summary-file"),
    ref: z.string().min(1),
    rawIncluded: z.boolean()
  })
  .catchall(z.unknown());

const derivedItemsSchema = z
  .object({
    decisions: z.array(z.string()).default([]),
    tasks: z.array(z.string()).default([]),
    contextUpdates: z.array(z.string()).default([]),
    pitfalls: z.array(z.string()).default([])
  })
  .catchall(z.array(z.string()));

export const sessionFrontmatterSchema = z
  .object({
    type: z.literal("agent-session"),
    schemaVersion: schemaVersionOne,
    title: z.string().min(1),
    date: dateOnlySchema,
    capturedAt: isoDateTimeSchema,
    agent: z.string().min(1),
    tool: z.string().min(1),
    projectId: slugSchema.optional(),
    project: z.string().min(1).optional(),
    repoId: slugSchema.optional(),
    scope: scopeSchema,
    status: z.enum(["done", "handoff"]),
    visibility: visibilitySchema,
    source: sourceSchema,
    sourceRefs: z.array(sourceRefSchema).min(1),
    derivedItems: derivedItemsSchema,
    tags: z.array(z.string()).default([])
  })
  .catchall(z.unknown())
  .superRefine((value, context) => {
    const frontmatter = value as Record<string, unknown>;

    for (const key of forbiddenTrackedFrontmatterKeys) {
      if (Object.hasOwn(frontmatter, key)) {
        context.addIssue({
          code: "custom",
          message: `tracked session frontmatter 不允許 ${key}`
        });
      }
    }

    for (const finding of findBlockedTrackedValues(frontmatter)) {
      context.addIssue({
        code: "custom",
        message: `tracked session frontmatter 含本機或私有路徑: ${finding}`
      });
    }

    if (value.scope === "project" && (value.projectId === undefined || value.repoId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "scope=project 時 projectId 與 repoId 必填"
      });
    }

    if (value.source.rawIncluded && value.visibility !== "private") {
      context.addIssue({
        code: "custom",
        message: "rawIncluded=true 時 visibility 必須是 private"
      });
    }
  });

export type SessionFrontmatter = z.infer<typeof sessionFrontmatterSchema>;

export function parseSessionFrontmatter(value: unknown): SessionFrontmatter {
  return parseSchema(sessionFrontmatterSchema, value, ErrorCode.CONFIG_INVALID, "session frontmatter");
}

function findBlockedTrackedValues(value: unknown, path: readonly string[] = []): string[] {
  if (typeof value === "string") {
    return isBlockedTrackedString(value, path) ? [path.join(".")] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findBlockedTrackedValues(item, [...path, String(index)]));
  }

  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, item]) => findBlockedTrackedValues(item, [...path, key]));
}

function isBlockedTrackedString(value: string, path: readonly string[]): boolean {
  const normalizedValue = value.replaceAll("\\", "/");

  if (blockedTrackedStringPatterns.some((pattern) => pattern.test(normalizedValue))) {
    return true;
  }

  const isAllowedTopLevelPrivateVisibility = path.length === 1 && path[0] === "visibility" && value === "private";
  const normalizedPath = normalizedValue === "." ? normalizedValue : normalizedValue.replace(/\/+$/u, "");
  const segments = normalizedPath.split("/").filter((segment) => segment !== "" && segment !== ".");

  if (segments.includes(".agent-notes")) {
    return true;
  }

  return !isAllowedTopLevelPrivateVisibility && segments.includes("private");
}
