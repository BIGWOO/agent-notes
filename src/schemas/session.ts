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
