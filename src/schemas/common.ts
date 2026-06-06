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

const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u;

export const isoDateTimeSchema = z
  .string()
  .regex(isoDateTimePattern, "必須是含時間與 timezone 的 ISO datetime")
  .refine(isStrictIsoDateTime, {
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

function isStrictIsoDateTime(value: string): boolean {
  const match = isoDateTimePattern.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);

  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    !Number.isNaN(Date.parse(value))
  );
}
