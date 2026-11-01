import { z } from "zod";
import { PROTOCOL_V4_LIMITS, V4_WIRE_PROTOCOL_VERSION } from "./core.js";
import { topicWireBase64Schema } from "./wire-binary.js";

export const topicWireChecksumSchema = z
  .object({
    algorithm: z.literal("crc32"),
    value: z.string().regex(/^[0-9a-f]{8}$/u),
  })
  .strict();
export type TopicWireChecksum = z.infer<typeof topicWireChecksumSchema>;

export const topicFrameDeliveryKindSchema = z.enum(["initial", "online", "recovery"]);
export type TopicFrameDeliveryKind = z.infer<typeof topicFrameDeliveryKindSchema>;

export type TopicWireFrame<F> =
  | {
      wireVersion: typeof V4_WIRE_PROTOCOL_VERSION;
      kind: "complete";
      deliveryKind: TopicFrameDeliveryKind;
      logicalFrameId: string;
      logicalFrameOrdinal: number;
      topic: string;
      subscriptionId: string;
      frame: F;
    }
  | {
      wireVersion: typeof V4_WIRE_PROTOCOL_VERSION;
      kind: "fragment";
      deliveryKind: TopicFrameDeliveryKind;
      logicalFrameId: string;
      logicalFrameOrdinal: number;
      topic: string;
      subscriptionId: string;
      fragmentIndex: number;
      fragmentCount: number;
      logicalBytes: number;
      checksum: TopicWireChecksum;
      dataBase64: string;
    };

export const topicWireFrameCandidateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      wireVersion: z.literal(V4_WIRE_PROTOCOL_VERSION),
      kind: z.literal("complete"),
      deliveryKind: z.unknown().optional(),
      logicalFrameId: z.string().min(1),
      logicalFrameOrdinal: z.number(),
      topic: z.string().min(1),
      subscriptionId: z.string().min(1),
      frame: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      wireVersion: z.literal(V4_WIRE_PROTOCOL_VERSION),
      kind: z.literal("fragment"),
      deliveryKind: z.unknown().optional(),
      logicalFrameId: z.string().min(1),
      logicalFrameOrdinal: z.number(),
      topic: z.string().min(1),
      subscriptionId: z.string().min(1),
      fragmentIndex: z.unknown().optional(),
      fragmentCount: z.unknown().optional(),
      logicalBytes: z.unknown().optional(),
      checksum: z.unknown().optional(),
      dataBase64: z.unknown().optional(),
    })
    .passthrough(),
]);
export type TopicWireFrameCandidate = z.infer<typeof topicWireFrameCandidateSchema>;

export function createTopicWireFrameSchema<F extends z.ZodTypeAny>(frameSchema: F) {
  return z
    .discriminatedUnion("kind", [
      z
        .object({
          wireVersion: z.literal(V4_WIRE_PROTOCOL_VERSION),
          kind: z.literal("complete"),
          deliveryKind: topicFrameDeliveryKindSchema,
          logicalFrameId: z.string().min(1),
          logicalFrameOrdinal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          topic: z.string().min(1),
          subscriptionId: z.string().min(1),
          frame: frameSchema,
        })
        .strict(),
      z
        .object({
          wireVersion: z.literal(V4_WIRE_PROTOCOL_VERSION),
          kind: z.literal("fragment"),
          deliveryKind: topicFrameDeliveryKindSchema,
          logicalFrameId: z.string().min(1),
          logicalFrameOrdinal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          topic: z.string().min(1),
          subscriptionId: z.string().min(1),
          fragmentIndex: z.number().int().nonnegative(),
          fragmentCount: z
            .number()
            .int()
            .positive()
            .max(PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxFragments),
          logicalBytes: z.number().int().positive(),
          checksum: topicWireChecksumSchema,
          dataBase64: topicWireBase64Schema,
        })
        .strict(),
    ])
    .superRefine((wire, context) => {
      const value = wire as unknown as TopicWireFrame<z.output<F>>;
      if (value.kind === "fragment") {
        if (value.fragmentIndex >= value.fragmentCount) {
          context.addIssue({
            code: "custom",
            message: "fragmentIndex must be smaller than fragmentCount",
            path: ["fragmentIndex"],
          });
        }
        if (value.fragmentCount > value.logicalBytes) {
          context.addIssue({
            code: "custom",
            message: "fragmentCount cannot exceed logicalBytes",
            path: ["fragmentCount"],
          });
        }
        return;
      }
      const frame = value.frame as {
        topic?: unknown;
        subscriptionId?: unknown;
      };
      if (frame.topic !== value.topic) {
        context.addIssue({
          code: "custom",
          message: "complete wire topic must match logical frame topic",
          path: ["topic"],
        });
      }
      if (frame.subscriptionId !== value.subscriptionId) {
        context.addIssue({
          code: "custom",
          message: "complete wire subscriptionId must match logical frame subscriptionId",
          path: ["subscriptionId"],
        });
      }
    });
}
