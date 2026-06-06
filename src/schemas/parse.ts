import type { z } from "zod";
import { AgentNotesError, ErrorCode } from "../core/errors.js";

export function parseSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallbackCode: ErrorCode,
  label: string
): T {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const code = errorCodeFromIssues(result.error.issues) ?? fallbackCode;
  const message = result.error.issues.map((issue) => issue.message).join("; ");

  throw new AgentNotesError(code, `${label} schema validation failed: ${message}`);
}

export function unsupportedIssue(message: string): {
  readonly code: "custom";
  readonly message: string;
  readonly params: {
    readonly errorCode: ErrorCode.FEATURE_UNSUPPORTED;
  };
} {
  return {
    code: "custom",
    message,
    params: {
      errorCode: ErrorCode.FEATURE_UNSUPPORTED
    }
  };
}

function errorCodeFromIssues(issues: readonly z.ZodIssue[]): ErrorCode | undefined {
  for (const issue of issues) {
    const params = "params" in issue ? issue.params : undefined;

    if (isErrorCode(params?.errorCode)) {
      return params.errorCode;
    }
  }

  return undefined;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.values(ErrorCode).includes(value as ErrorCode);
}
