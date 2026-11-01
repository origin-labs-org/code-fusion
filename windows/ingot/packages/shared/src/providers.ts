import { z } from "zod";

export const CF_PROVIDERS = ["glm"] as const;

export const cfProviderSchema = z.enum(CF_PROVIDERS);

export type CfProvider = (typeof CF_PROVIDERS)[number];
