import type { PlanView } from "./types";

export type CalendarDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  day: number;
  /** The first day of a month: it names the month. */
  opens: boolean;
  /** Before the plan's first day or after its last. */
  outside: boolean;
  today: boolean;
  weekend: boolean;
  /** Indices of the plan's steps on this day, in plan order, bars apart. */
  steps: number[];
  /** What a multi-day step draws here, one entry per lane of its week: null where the lane is free. */
  slots: (CalendarSlot | null)[];
};

/** One day's share of a step that lasts several days, drawn as one bar across its week. */
export type CalendarSlot = {
  /** Every step the bar stands for, in day order. */
  steps: number[];
  title: string;
  kind: PlanView["steps"][number]["kind"];
  done: boolean;
  /** The first day of the bar in this week: it carries the title. */
  head: boolean;
  /** The step's real first and last day, where the bar is rounded. */
  starts: boolean;
  ends: boolean;
  /** Days the bar covers in this week, counted from its head. */
  span: number;
  from: string;
  to: string;
};

export type CalendarWeek = {
  kind: "week";
  days: CalendarDay[];
  /** Lanes of bars above the days' own steps. */
  lanes: number;
  /** Lines the busiest day needs: its steps, or two and a count. */
  lines: number;
  /** `YYYY-MM` of the month this week opens, where it differs from the week before. */
  month: string | null;
};
type CalendarQuiet = { kind: "quiet"; weeks: number; from: string; to: string };
export type CalendarRow = CalendarWeek | CalendarQuiet;

/** Steps a day lists before it keeps two and counts the rest. */
export const SHOWN = 3;

/** A plan of this many dated steps over at least this many days reads as a calendar. */
const LEAST_STEPS = 6;
const LEAST_DAYS = 10;
/** Longer than this, the calendar would outgrow a result. */
const MOST_WEEKS = 10;

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parse = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};
const DAY_MS = 86_400_000;

/** 1 for Monday, 7 for Sunday: the locale's first day of the week. */
export function firstWeekday(locale?: string): number {
  try {
    const info = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    return info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1;
  } catch {
    return 1;
  }
}

/**
 * A dated plan as weeks of days, or null when it reads better as a timeline:
 * too few dated steps, too short a span, or too long to stand on the canvas.
 */
export function planWeeks(
  plan: PlanView,
  options: { today?: Date; firstDay?: number; month?: Date } = {},
): CalendarDay[][] | null {
  const dated = plan.steps.flatMap((step, index) =>
    step.date ? [{ index, date: step.date }] : [],
  );
  const days = dated.map(({ date }) => parse(date).getTime());
  let first: Date;
  let last: Date;
  if (plan.calendar && options.month) {
    first = new Date(options.month.getFullYear(), options.month.getMonth(), 1);
    last = new Date(options.month.getFullYear(), options.month.getMonth() + 1, 0);
  } else if (plan.calendar) {
    // A calendar the agent drew: whole months, from its first day's month (this one when empty).
    const now = options.today ?? new Date();
    const from = days.length ? new Date(Math.min(...days)) : now;
    const to = days.length ? new Date(Math.max(...days)) : now;
    first = new Date(from.getFullYear(), from.getMonth(), 1);
    last = new Date(to.getFullYear(), to.getMonth() + 1, 0);
  } else {
    if (dated.length < LEAST_STEPS || dated.length < plan.steps.length * 0.8) return null;
    first = new Date(Math.min(...days));
    last = new Date(Math.max(...days));
    if (Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1 < LEAST_DAYS) return null;
  }
  const weekStart = (options.firstDay ?? firstWeekday()) % 7;
  const start = new Date(first);
  start.setDate(start.getDate() - ((start.getDay() - weekStart + 7) % 7));
  const end = new Date(last);
  end.setDate(end.getDate() + ((weekStart + 6 - end.getDay() + 7) % 7));
  const span = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (span / 7 > MOST_WEEKS && !plan.calendar) return null;
  const byDay = new Map<string, number[]>();
  for (const { index, date } of dated) byDay.set(date, [...(byDay.get(date) ?? []), index]);
  const today = iso(options.today ?? new Date());
  const firstIso = iso(first);
  const lastIso = iso(last);
  const weeks: CalendarDay[][] = [];
  for (let offset = 0; offset < span; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const date = iso(day);
    if (offset % 7 === 0) weeks.push([]);
    weeks.at(-1)!.push({
      date,
      day: day.getDate(),
      opens: offset === 0 || day.getDate() === 1,
      outside: date < firstIso || date > lastIso,
      today: date === today,
      weekend: day.getDay() === 0 || day.getDay() === 6,
      steps: byDay.get(date) ?? [],
      slots: [],
    });
  }
  return weeks;
}

/** The calendar's size on the canvas: a rail for the months, then seven columns of days. */
export const CALENDAR = {
  gutter: 36,
  cell: 124,
  head: 28,
  quiet: 32,
  pad: 8,
  number: 22,
  gap: 4,
  item: 20,
  between: 2,
  rule: 1,
} as const;
export const calendarWidth = () => CALENDAR.gutter + 7 * CALENDAR.cell;

/** A week as tall as its bars and its busiest day need, never under the floor's lines. */
export function weekHeight(lanes: number, lines: number, floor = 0): number {
  const items = Math.max(lanes + lines, floor);
  const list = items ? CALENDAR.gap + items * CALENDAR.item + (items - 1) * CALENDAR.between : 0;
  return 2 * CALENDAR.pad + CALENDAR.number + list + CALENDAR.rule;
}

export const calendarHeight = (rows: readonly CalendarRow[], month = false) =>
  CALENDAR.head +
  rows.reduce(
    (sum, row) =>
      sum +
      (row.kind === "quiet"
        ? CALENDAR.quiet + CALENDAR.rule
        : weekHeight(row.lanes, row.lines, month ? SHOWN : 0)),
    0,
  );

const nextDay = (value: string) => {
  const day = parse(value);
  return iso(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1));
};

type Run = { steps: number[]; from: string; to: string };

/**
 * Steps that last (a stay, an event) written once a day under one name make
 * one run. The plan has no end date to say so; the days it repeats it on do.
 */
function runs(plan: PlanView): Run[] {
  const keyOf = (index: number, date: string) =>
    `${plan.steps[index]!.kind}|${plan.steps[index]!.title.trim().toLowerCase()}|${date}`;
  const lasting = plan.steps.flatMap((step, index) =>
    step.date && (step.kind === "stay" || step.kind === "event") ? [index] : [],
  );
  const byKey = new Map(lasting.map((index) => [keyOf(index, plan.steps[index]!.date!), index]));
  const taken = new Set<number>();
  const found: Run[] = [];
  const ordered = lasting.toSorted((a, b) =>
    plan.steps[a]!.date!.localeCompare(plan.steps[b]!.date!),
  );
  for (const index of ordered) {
    if (taken.has(index)) continue;
    const chain = [index];
    for (;;) {
      const next = byKey.get(keyOf(chain.at(-1)!, nextDay(plan.steps[chain.at(-1)!]!.date!)));
      if (next === undefined || taken.has(next)) break;
      chain.push(next);
    }
    if (chain.length < 2) continue;
    for (const step of chain) taken.add(step);
    found.push({
      steps: chain,
      from: plan.steps[chain[0]!]!.date!,
      to: plan.steps[chain.at(-1)!]!.date!,
    });
  }
  return found;
}

function bind(plan: PlanView, week: CalendarDay[], long: Run[]): CalendarWeek {
  const first = week[0]!.date;
  const last = week[6]!.date;
  const here = long
    .filter((run) => run.from <= last && run.to >= first)
    .toSorted((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to));
  const lanes: number[] = [];
  const days = week.map((day) => ({ ...day, slots: [] as (CalendarSlot | null)[] }));
  const consumed = new Set<number>();
  for (const run of here) {
    const start = Math.max(
      0,
      days.findIndex((day) => day.date >= run.from),
    );
    const end = days.findLastIndex((day) => day.date <= run.to);
    let lane = lanes.findIndex((until) => until < start);
    if (lane < 0) lane = lanes.push(end) - 1;
    else lanes[lane] = end;
    const lead = plan.steps[run.steps[0]!]!;
    for (let column = start; column <= end; column++) {
      const day = days[column]!;
      while (day.slots.length <= lane) day.slots.push(null);
      day.slots[lane] = {
        steps: run.steps,
        title: lead.title,
        kind: lead.kind,
        done: run.steps.every((index) => !!plan.steps[index]!.done),
        head: column === start,
        starts: day.date === run.from,
        ends: day.date === run.to,
        span: end - start + 1,
        from: run.from,
        to: run.to,
      };
    }
    for (const index of run.steps) consumed.add(index);
  }
  for (const day of days) {
    day.steps = day.steps.filter((index) => !consumed.has(index));
    while (day.slots.length < lanes.length) day.slots.push(null);
  }
  return { kind: "week", days, lanes: lanes.length, lines: linesOf(days), month: null };
}

const linesOf = (days: CalendarDay[]) =>
  Math.max(0, ...days.map((day) => Math.min(day.steps.length, SHOWN)));

const monthKey = (week: CalendarWeek) =>
  (week.days.find((day) => day.day === 1) ?? week.days[0]!).date.slice(0, 7);

/** Names the month on the week that opens it; a month's own view names only its first. */
function named(rows: CalendarRow[], first = false): CalendarRow[] {
  let shown = "";
  for (const row of rows) {
    if (row.kind !== "week") continue;
    const key = monthKey(row);
    if (key !== shown && !(first && shown)) row.month = key;
    shown = key;
  }
  return rows;
}

export type CalendarOptions = {
  today?: Date;
  firstDay?: number;
  /** The one month the person's calendar turns to: all its weeks, empty or not. */
  month?: Date;
};

/**
 * A plan as the rows a calendar draws, or null when it reads better as a
 * timeline. A month keeps every week it has. Any other plan shows only the
 * weeks from its first step's to its last's, a run of quiet ones folded into
 * one row, and a step that lasts several days as one bar across them.
 */
export function planCalendar(plan: PlanView, options: CalendarOptions = {}): CalendarRow[] | null {
  const weeks = planWeeks(plan, options);
  if (!weeks) return null;
  const whole = () =>
    named(
      weeks.map((days): CalendarWeek => ({
        kind: "week",
        days,
        lanes: 0,
        lines: linesOf(days),
        month: null,
      })),
      true,
    );
  if (options.month) return whole();
  const long = runs(plan);
  const bound = weeks.map((days) =>
    bind(
      plan,
      days.map((day) => ({ ...day, outside: false, opens: day.day === 1 })),
      long,
    ),
  );
  const busy = (week: CalendarWeek) =>
    week.lanes > 0 || week.days.some((day) => day.steps.length > 0);
  const from = bound.findIndex(busy);
  const to = bound.findLastIndex(busy);
  if (from < 0) return whole();
  const rows: CalendarRow[] = [];
  for (let at = from; at <= to;) {
    if (busy(bound[at]!)) {
      rows.push(bound[at++]!);
      continue;
    }
    let end = at;
    while (end < to && !busy(bound[end + 1]!)) end++;
    if (end === at) rows.push(bound[at]!);
    else
      rows.push({
        kind: "quiet",
        weeks: end - at + 1,
        from: bound[at]!.days[0]!.date,
        to: bound[end]!.days[6]!.date,
      });
    at = end + 1;
  }
  return named(rows);
}

/** What the canvas sizes a plan's calendar by: a fresh one holds its month, a dated one its weeks. */
export function calendarRowsFor(plan: PlanView): { rows: CalendarRow[]; month: boolean } | null {
  if (plan.calendar && !plan.steps.some((step) => step.date)) {
    const rows = planCalendar(plan, { month: openingMonth(plan) });
    return rows && { rows, month: true };
  }
  const rows = planCalendar(plan);
  return rows && { rows, month: false };
}

/** The month a calendar opens on: its first day's, or this one when it holds none. */
export function openingMonth(plan: PlanView, today = new Date()): Date {
  const days = plan.steps.flatMap((step) => (step.date ? [step.date] : [])).sort();
  const first = days[0] ? parse(days[0]) : today;
  return new Date(first.getFullYear(), first.getMonth(), 1);
}
