//
// ConversationSnapshot：synthesizeEventsFromMessages → mergeColdConversationEvents →
//
export { ProductProjection } from "./product-projection.js";
export { synthesizeEventsFromMessages } from "./transcript-hydration.js";
export { mergeColdConversationEvents, type ColdEventMergeResult } from "./cold-event-merge.js";
export { HYDRATION_TRACE_ID } from "./projection-state.js";
