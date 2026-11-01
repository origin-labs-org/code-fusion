import { z } from "zod";

export const projectTokenSuccessCodeSchema = z.union([
  z.literal(200),
  z.literal(0),
  z.literal("200"),
  z.literal("0"),
]);
