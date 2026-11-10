import { oneOf } from "./choices.js";

export const REPEAT_UNITS = ["day", "week", "month", "year"] as const;

export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export const isRepeatUnit = oneOf(REPEAT_UNITS);

export type Repeat = { every: number; unit: RepeatUnit };

export const POSTPONE_DAYS = [1, 3, 7, 15] as const;

export type PostponeDays = (typeof POSTPONE_DAYS)[number];

export const isPostponeDays = oneOf(POSTPONE_DAYS);

// A pending task in any of my lists; due is the calendar day (YYYY-MM-DD), null when it has none.
export type TaskEntry = {
  id: string;
  listId: string;
  account: string;
  title: string;
  due: string | null;
  url: string;
  ruleId: number | null;
};

export type TaskList = { account: string; id: string; title: string };

// A repetition Jarvis keeps, because Google Tasks does not expose its own: one task at a time, the next one created
// once the current one is done.
export type TaskRule = {
  id: number;
  account: string;
  listId: string;
  title: string;
  repeat: Repeat;
  currentDue: string | null;
};

export type TasksResponse = { lists: TaskList[]; tasks: TaskEntry[]; rules: TaskRule[]; reconnect: string[] };

export type TaskCreate = { account: string; listId: string; title: string; due: string | null; repeat: Repeat | null };

export type TaskUpdate = { title?: string; due?: string | null };

// "cada día", "cada 2 semanas": the label the UI and the task's note use.
export const repeatLabel = ({ every, unit }: Repeat): string => {
  const one = { day: "día", week: "semana", month: "mes", year: "año" }[unit];
  const many = { day: "días", week: "semanas", month: "meses", year: "años" }[unit];
  return every === 1 ? `cada ${one}` : `cada ${every} ${many}`;
};
