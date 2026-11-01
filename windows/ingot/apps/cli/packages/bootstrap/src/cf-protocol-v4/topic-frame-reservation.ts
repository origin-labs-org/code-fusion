import type { TopicFrameDeliveryKind } from "@origin-ai/cf-shared/cf-protocol-v4";

export interface TopicFrameReservation<F> {
  
  readonly deliveryKind: TopicFrameDeliveryKind;
  readonly logicalFrameId: string;
  
  readonly logicalFrameOrdinal: number;
  readonly frame: F;
  
  commit(): boolean;
}
