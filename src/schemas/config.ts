import { z } from "zod";
import { ErrorCode } from "../core/errors.js";
import { absolutePathSchema, localeSchema, schemaVersionOne, visibilitySchema } from "./common.js";
import { parseSchema, unsupportedIssue } from "./parse.js";

const privacySchema = z
  .object({
    defaultVisibility: visibilitySchema,
    recordAbsolutePathsInNotes: z.boolean(),
    copyRawTranscripts: z.boolean()
  })
  .catchall(z.unknown())
  .superRefine((value, context) => {
    if (value.defaultVisibility !== "private") {
      context.addIssue(unsupportedIssue("Phase 1 只支援 defaultVisibility=private"));
    }

    if (value.recordAbsolutePathsInNotes) {
      context.addIssue(unsupportedIssue("Phase 1 不允許把絕對路徑寫入 tracked notes"));
    }

    if (value.copyRawTranscripts) {
      context.addIssue(unsupportedIssue("Phase 1 不支援 raw transcript copy"));
    }
  });

const sharingSchema = z
  .object({
    mode: z.enum(["personal", "team"]),
    access: z.enum(["read-write", "read-only"]),
    agentWritePolicy: z.enum(["none", "local-only", "branch-pr", "direct"])
  })
  .catchall(z.unknown())
  .superRefine((value, context) => {
    if (value.mode !== "personal") {
      context.addIssue(unsupportedIssue("Phase 1 只支援 sharing.mode=personal"));
    }

    if (value.access !== "read-write") {
      context.addIssue(unsupportedIssue("Phase 1 只支援 sharing.access=read-write"));
    }

    if (value.agentWritePolicy !== "local-only") {
      context.addIssue(unsupportedIssue("Phase 1 只支援 sharing.agentWritePolicy=local-only"));
    }
  });

const integrationsSchema = z
  .object({
    codex: z
      .object({
        enabled: z.boolean()
      })
      .catchall(z.unknown())
      .optional()
  })
  .catchall(z.unknown());

export const localConfigSchema = z
  .object({
    version: schemaVersionOne,
    locale: localeSchema,
    vaultPath: absolutePathSchema,
    projectMapPath: absolutePathSchema,
    privacy: privacySchema,
    sharing: sharingSchema,
    integrations: integrationsSchema
  })
  .catchall(z.unknown());

export type LocalConfig = z.infer<typeof localConfigSchema>;

export function parseLocalConfig(value: unknown): LocalConfig {
  return parseSchema(localConfigSchema, value, ErrorCode.CONFIG_INVALID, "local config");
}
