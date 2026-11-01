import type { CfSessionFile, CfTaskMeta } from "@origin-ai/cf-shared";
import { cfSessionFileSchema, cfTaskMetaSchema, cfTaskModeSchema } from "@origin-ai/cf-shared";

export type LegacyTaskSessionFile = Omit<CfSessionFile, "meta"> & {
  meta: Omit<CfTaskMeta, "mode"> & { mode?: CfTaskMeta["mode"] };
};

const legacyTaskSessionFileSchema = cfSessionFileSchema.extend({
  meta: cfTaskMetaSchema.extend({
    mode: cfTaskModeSchema.optional(),
  }),
});

export function parseLegacyTaskSessionFile(input: unknown): LegacyTaskSessionFile {
  return legacyTaskSessionFileSchema.parse(input);
}

export function safeParseLegacyTaskSessionFile(input: unknown) {
  return legacyTaskSessionFileSchema.safeParse(input);
}
