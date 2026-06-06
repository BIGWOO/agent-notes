import { z } from "zod";
import { isAbsolutePath, isVaultRelativePath } from "../core/paths.js";

export const schemaVersionOne = z.literal(1);

export const localeSchema = z.enum(["en", "zh-TW"]);

export const visibilitySchema = z.enum(["private", "team-safe", "public-safe"]);

export const scopeSchema = z.enum(["inbox", "daily", "area", "personal", "project"]);

export const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/u, "必須是 lowercase slug");

export const sourceRefSchema = z
  .string()
  .min(1)
  .regex(/^src_[A-Za-z0-9][A-Za-z0-9_-]*$/u, "sourceRef 必須使用 src_ 前綴");

export const sessionIdSchema = z
  .string()
  .min(1)
  .regex(/^SES-[A-Za-z0-9][A-Za-z0-9_-]*$/u, "sessionId 必須使用 SES- 前綴");

export const itemIdSchema = z
  .string()
  .min(1)
  .regex(/^(DEC|TASK|CTX|PIT)-[0-9]{4,}$/u, "itemId 必須使用穩定前綴");

export const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "必須是可解析的 ISO datetime"
});

export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "必須是 YYYY-MM-DD");

export const absolutePathSchema = z.string().min(1).refine(isAbsolutePath, {
  message: "必須是絕對路徑"
});

export const vaultRelativePathSchema = z.string().min(1).refine(isVaultRelativePath, {
  message: "必須是 vault-relative path"
});

export const contentHashSchema = z.string().startsWith("sha256:");
