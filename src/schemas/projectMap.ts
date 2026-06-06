import { z } from "zod";
import { ErrorCode } from "../core/errors.js";
import {
  absolutePathSchema,
  schemaVersionOne,
  slugSchema,
  vaultRelativePathSchema,
  visibilitySchema
} from "./common.js";
import { parseSchema } from "./parse.js";

export const projectMapEntrySchema = z
  .object({
    id: slugSchema,
    name: z.string().min(1),
    repoId: slugSchema,
    repoPaths: z.array(absolutePathSchema).min(1),
    notePath: vaultRelativePathSchema,
    tags: z.array(slugSchema).optional(),
    visibility: visibilitySchema
  })
  .catchall(z.unknown());

export const projectMapSchema = z
  .object({
    version: schemaVersionOne,
    vaultPath: absolutePathSchema,
    projects: z.array(projectMapEntrySchema)
  })
  .catchall(z.unknown())
  .superRefine((value, context) => {
    const projectIds = new Set<string>();
    const repoIds = new Set<string>();

    for (const project of value.projects) {
      if (projectIds.has(project.id)) {
        context.addIssue({
          code: "custom",
          message: `project id 重複: ${project.id}`
        });
      }

      if (repoIds.has(project.repoId)) {
        context.addIssue({
          code: "custom",
          message: `repoId 重複: ${project.repoId}`
        });
      }

      projectIds.add(project.id);
      repoIds.add(project.repoId);
    }
  });

export type ProjectMap = z.infer<typeof projectMapSchema>;
export type ProjectMapEntry = z.infer<typeof projectMapEntrySchema>;

export function parseProjectMap(value: unknown): ProjectMap {
  return parseSchema(projectMapSchema, value, ErrorCode.PROJECT_MAP_INVALID, "project map");
}
