import type { AccountRequestV1 } from "$shared/ipc/bindings";
import { requestStanding, sumUnits } from "$domain/account";

/** The calls made for one thing: a Work task, voice, or none this computer knows. */
export type CallGroup = {
  /** Stable while pages load: a task's profile and id, `voice`, `page`, or `other`. */
  key: string;
  kind: "task" | "voice" | "page" | "other";
  /** The task's owner and id, to look its title up; only with `task`. */
  task: { profile: string; work: string } | null;
  /** Newest first, as the service lists them. */
  calls: AccountRequestV1[];
  /** When its newest call began. */
  latest: string | null;
  /** Units charged by settled calls. Calls still being confirmed add nothing. */
  total: string;
  /** Calls still running or being confirmed. */
  unsettled: number;
};

/**
 * Groups history by what each call was made for, using this computer's own
 * record of it. Groups keep the order their newest call gives them.
 */
export function groupCalls(requests: readonly AccountRequestV1[]): CallGroup[] {
  const groups = new Map<string, CallGroup>();
  for (const call of requests) {
    const source = call.source;
    const key =
      source?.kind === "task" ? `task:${source.profile}:${source.work}` : (source?.kind ?? "other");
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind: source?.kind ?? "other",
        task: source?.kind === "task" ? { profile: source.profile, work: source.work } : null,
        calls: [],
        latest: call.started_at,
        total: "0",
        unsettled: 0,
      };
      groups.set(key, group);
    }
    group.calls.push(call);
  }
  for (const group of groups.values()) {
    group.total = sumUnits(
      group.calls.filter((call) => call.state === "settled").map((call) => call.charged),
    );
    group.unsettled = group.calls.filter((call) => {
      const standing = requestStanding(call.state);
      return standing === "checking" || standing === "running";
    }).length;
  }
  return [...groups.values()];
}

/** A time as milliseconds, or null when it is missing or unreadable. */
export function moment(iso: string | null | undefined): number | null {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(at) ? null : at;
}

/** Local midnight of the day a time falls on. */
export function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Calendar days, so a day that gains or loses an hour still counts as one. */
export function addDays(day: number, count: number): number {
  const date = new Date(day);
  date.setDate(date.getDate() + count);
  return date.getTime();
}

/**
 * Calls by the local day they began, days in the order their first call is
 * listed. A call without a start time sits with the one listed before it.
 */
export function callsByDay(
  requests: readonly AccountRequestV1[],
  today: number,
): Array<{ day: number; calls: AccountRequestV1[] }> {
  const days: Array<{ day: number; calls: AccountRequestV1[] }> = [];
  let last = today;
  for (const call of requests) {
    const at = moment(call.started_at);
    const day = at === null ? last : startOfDay(at);
    last = day;
    const listed = days.find((entry) => entry.day === day);
    if (listed) listed.calls.push(call);
    else days.push({ day, calls: [call] });
  }
  return days;
}
