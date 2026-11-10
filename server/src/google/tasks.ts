import type { TaskEntry, TaskList } from "../../../shared/tasks.js";
import type { StoredAccount } from "./accounts.js";
import { GoogleApiError, googleRequest } from "./api.js";
import { GoogleAuthExpired, TASKS_SCOPE, type GoogleAuth } from "./oauth.js";

const TASKS_API = "https://tasks.googleapis.com/tasks/v1";

type Account = Pick<StoredAccount, "email" | "refreshToken" | "scopes">;

type GoogleTask = { id: string; title?: string; due?: string; status?: string; deleted?: boolean; webViewLink?: string };

const taskUrl = (listId: string, taskId?: string): string =>
  `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`;

// Google keeps a due date as midnight UTC of the calendar day; null clears it.
const dueField = (due: string | null): string | null => (due ? `${due}T00:00:00.000Z` : null);

export type TaskFields = { title?: string; notes?: string; due?: string | null };

// JSON drops the fields left undefined, so a PATCH changes only what was given.
const body = (fields: TaskFields): Record<string, unknown> => ({
  ...fields,
  ...(fields.due !== undefined ? { due: dueField(fields.due) } : {}),
});

type Pending = { account: Account; list: TaskList; task: GoogleTask & { id: string } };

// Every pending task of every list of these accounts. An account connected before Tasks
// (or whose access expired) is reported instead of failing the others.
const readPending = async (
  accounts: Account[],
  auth: GoogleAuth,
  fetchFn: typeof fetch,
): Promise<{ lists: TaskList[]; pending: Pending[]; reconnect: string[] }> => {
  const lists: TaskList[] = [];
  const pending: Pending[] = [];
  const reconnect: string[] = [];
  for (const account of accounts) {
    if (!account.scopes.split(" ").includes(TASKS_SCOPE)) {
      reconnect.push(account.email);
      continue;
    }
    try {
      const { items: found = [] } = await googleRequest<{ items?: { id: string; title?: string }[] }>(
        auth,
        account,
        fetchFn,
        `${TASKS_API}/users/@me/lists?maxResults=100`,
      );
      const perList = await Promise.all(
        found.map(async (raw) => {
          const list: TaskList = { account: account.email, id: raw.id, title: raw.title?.trim() || "Mis tareas" };
          const items: GoogleTask[] = [];
          let pageToken: string | undefined;
          do {
            const url = new URL(taskUrl(list.id));
            url.search = new URLSearchParams({
              showCompleted: "false",
              maxResults: "100",
              ...(pageToken ? { pageToken } : {}),
            }).toString();
            const page = await googleRequest<{ items?: GoogleTask[]; nextPageToken?: string }>(
              auth,
              account,
              fetchFn,
              url.toString(),
            );
            items.push(...(page.items ?? []));
            pageToken = page.nextPageToken;
          } while (pageToken);
          return { list, items };
        }),
      );
      for (const { list, items } of perList) {
        lists.push(list);
        for (const task of items) pending.push({ account, list, task });
      }
    } catch (error) {
      if (error instanceof GoogleAuthExpired) reconnect.push(account.email);
      else throw error;
    }
  }
  return { lists, pending, reconnect };
};

// Google stores a due date as midnight UTC: the date part is the calendar day, whatever the zone.
const dueDay = (task: GoogleTask): string | null => task.due?.slice(0, 10) ?? null;

// The account a task write names is not one of my connected personal accounts.
export class UnknownTaskAccount extends Error {}

// Every pending task, dated or not, with the lists they live in. Today keeps the ones due by today.
export const readAllTasks = async (
  accounts: Account[],
  auth: GoogleAuth,
  fetchFn: typeof fetch,
): Promise<{ lists: TaskList[]; tasks: TaskEntry[]; reconnect: string[] }> => {
  const { lists, pending, reconnect } = await readPending(accounts, auth, fetchFn);
  const tasks = pending.map(
    ({ account, list, task }): TaskEntry => ({
      id: task.id,
      listId: list.id,
      account: account.email,
      title: task.title?.trim() || "(sin título)",
      due: dueDay(task),
      url: task.webViewLink ?? "https://tasks.google.com/",
      ruleId: null,
    }),
  );
  return { lists, tasks, reconnect };
};

export const completeTask = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  listId: string,
  taskId: string,
): Promise<void> => {
  await googleRequest(auth, account, fetchFn, taskUrl(listId, taskId), { method: "PATCH", body: { status: "completed" } });
};

export const createTask = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  listId: string,
  fields: TaskFields & { title: string },
): Promise<{ id: string }> =>
  googleRequest<{ id: string }>(auth, account, fetchFn, taskUrl(listId), { method: "POST", body: body(fields) });

export const updateTask = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  listId: string,
  taskId: string,
  fields: TaskFields,
): Promise<void> => {
  await googleRequest(auth, account, fetchFn, taskUrl(listId, taskId), { method: "PATCH", body: body(fields) });
};

export const deleteTask = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  listId: string,
  taskId: string,
): Promise<void> => {
  await googleRequest(auth, account, fetchFn, taskUrl(listId, taskId), { method: "DELETE" });
};

// Where a task Jarvis created stands now; null once it is gone from Google.
export const getTask = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  listId: string,
  taskId: string,
): Promise<{ done: boolean; deleted: boolean; due: string | null } | null> => {
  try {
    const task = await googleRequest<GoogleTask>(auth, account, fetchFn, taskUrl(listId, taskId));
    return { done: task.status === "completed", deleted: task.deleted === true, due: dueDay(task) };
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
};
