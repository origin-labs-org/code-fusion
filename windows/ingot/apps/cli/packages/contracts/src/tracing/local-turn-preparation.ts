import { LOCAL_TTFT_MAX_PENDING, localTtftNow, type LocalTtftDetail } from "@origin-ai/cf-shared";

type PreparationStage =
  | Exclude<LocalTtftDetail["stage"], "attempt" | "retry_wait" | "user_confirmation">
  | "execution";
export interface LocalTurnPreparationFact {
  sessionId: string;
  turnId: string;
  id: string;
  stage: PreparationStage;
  start: number;
  end?: number;
  outcome?: "completed" | "failed" | "cancelled";
}
type Subscription = { publish: (fact: LocalTurnPreparationFact) => void; sequence: number };
const subscriptions = new Map<string, Subscription>();
const noop = () => {};
export function observeLocalTurnPreparation(
  inputId: string,
  publish: Subscription["publish"],
): () => void {
  if (subscriptions.size >= LOCAL_TTFT_MAX_PENDING || subscriptions.has(inputId)) return noop;
  const subscription = { publish, sequence: 0 };
  subscriptions.set(inputId, subscription);
  return () => {
    if (subscriptions.get(inputId) === subscription) subscriptions.delete(inputId);
  };
}
export function beginLocalTurnPreparation(
  trace: { queryId?: string; sessionId?: string; turnId?: string },
  stage: PreparationStage,
): (outcome?: LocalTurnPreparationFact["outcome"]) => void {
  const subscription = trace.queryId ? subscriptions.get(trace.queryId) : undefined;
  if (!subscription || !trace.sessionId || !trace.turnId) return noop;
  const fact: LocalTurnPreparationFact = {
    sessionId: trace.sessionId,
    turnId: trace.turnId,
    id: `prepare:${subscription.sequence++}`,
    stage,
    start: localTtftNow(),
  };
  const publish = (value: LocalTurnPreparationFact) => {
    if (subscriptions.get(trace.queryId!) !== subscription) return;
    try {
      subscription.publish(value);
    } catch {
      
    }
  };
  publish(fact);
  let ended = false;
  return (outcome = "completed") => {
    if (ended) return;
    ended = true;
    publish({ ...fact, end: localTtftNow(), outcome });
  };
}
