import { z } from "zod";
import { ErrorCode } from "../core/errors.js";
import {
  contentHashSchema,
  isoDateTimeSchema,
  itemIdSchema,
  schemaVersionOne,
  sessionIdSchema,
  sourceRefSchema,
  vaultRelativePathSchema,
  visibilitySchema
} from "./common.js";
import { parseSchema } from "./parse.js";

const sourceIndexEntrySchema = z
  .object({
    kind: z.literal("summary-file"),
    tool: z.string().min(1),
    capturedAt: isoDateTimeSchema,
    sessionIds: z.array(sessionIdSchema).min(1),
    localPath: z.string().min(1),
    contentHash: contentHashSchema.optional(),
    privacy: visibilitySchema,
    rawIncluded: z.boolean(),
    redacted: z.boolean()
  })
  .catchall(z.unknown());

export const sourceIndexSchema = z
  .object({
    version: schemaVersionOne,
    sources: z.record(sourceRefSchema, sourceIndexEntrySchema)
  })
  .catchall(z.unknown());

export const provenanceEntrySchema = z
  .object({
    version: schemaVersionOne,
    event: z.enum([
      "session-created",
      "derived-item-created",
      "derived-item-updated",
      "marker-block-updated"
    ]),
    createdAt: isoDateTimeSchema,
    sessionId: sessionIdSchema,
    itemId: itemIdSchema.optional(),
    itemType: z.enum(["session", "decision", "task", "context-update", "pitfall", "marker-block"]).optional(),
    sourceRefs: z.array(sourceRefSchema).min(1),
    derivedFrom: z.string().min(1),
    notePath: vaultRelativePathSchema,
    contentHash: contentHashSchema.optional()
  })
  .catchall(z.unknown())
  .superRefine((value, context) => {
    if (value.event !== "session-created" && (value.itemId === undefined || value.itemType === undefined)) {
      context.addIssue({
        code: "custom",
        message: "generated item provenance 必須包含 itemId 與 itemType"
      });
    }
  });

export type SourceIndex = z.infer<typeof sourceIndexSchema>;
export type ProvenanceEntry = z.infer<typeof provenanceEntrySchema>;

export function parseSourceIndex(value: unknown): SourceIndex {
  return parseSchema(sourceIndexSchema, value, ErrorCode.CONFIG_INVALID, "source index");
}

export function parseProvenanceEntry(value: unknown): ProvenanceEntry {
  return parseSchema(provenanceEntrySchema, value, ErrorCode.CONFIG_INVALID, "provenance entry");
}
