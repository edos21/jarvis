import type { TaskEntry } from "./tasks.js";

export type AgendaItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  url: string;
};

// Today's tasks: only the ones due today or earlier are listed, so every one has a day.
export type TaskItem = TaskEntry & { due: string; overdue: boolean };

// reconnect: accounts whose Google access expired, or that were connected before Tasks, and need connecting again.
export type AgendaResponse = { items: AgendaItem[]; tasks: TaskItem[]; reconnect: string[] };
