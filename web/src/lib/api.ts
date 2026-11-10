import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AgendaResponse } from "../../../shared/calendar";
import type { GoogleStatus } from "../../../shared/google";
import type { ClaudeSessionsResponse, CleanupReport, MacCta, MacRange, MacResponse, MacSample, MoleReport } from "../../../shared/mac";
import type { MailAction, MailKind, MailResponse, MailboxResponse, SweepApply, SweepReport } from "../../../shared/mail";
import type { PaymentInput, PaymentsResponse } from "../../../shared/payments";
import type { NewsResponse, NewsTopic } from "../../../shared/news";
import type { NoteCreate, NoteFile, NoteSave, NoteSearchHit, NotesList } from "../../../shared/notes";
import type { ResearchDetail, ResearchInput, ResearchList, ResearchRun } from "../../../shared/research";
import type { SpendingResponse, StatementCsv, StatementCsvFile, StatementCsvSave, StatementImport } from "../../../shared/statements";
import type { PostponeDays, TaskCreate, TaskUpdate, TasksResponse } from "../../../shared/tasks";
import type { TodayResponse } from "../../../shared/today";
import type { HistoryRange, LevelInput, PositionHistory, WalletHistory, WalletResponse } from "../../../shared/wallet";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const request = async <T>(path: string, init?: RequestInit, fetchFn: typeof fetch = fetch): Promise<T> => {
  const res = await fetchFn(`/api${path}`, {
    ...init,
    // A FormData body sets its own multipart content type.
    headers: typeof init?.body === "string" ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Error ${res.status}`, res.status);
  return body;
};

const send = <T>(method: string, path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const TODAY_KEY = ["today"];
export const PAYMENTS_KEY = ["payments"];
export const MAC_KEY = ["mac"];

const FIVE_MIN = 5 * 60_000;

export const useToday = () =>
  useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => request<TodayResponse>("/today"),
    // Every few seconds only while the briefing is being written; otherwise every five minutes.
    refetchInterval: (query) => (query.state.data?.briefingStatus === "pending" ? 4000 : FIVE_MIN),
    refetchOnWindowFocus: true,
  });

// Read on one screen, read on all: the server keeps the day, the cached Today only flips its flag.
export const useMarkBriefingSeen = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => send<{ seenOn: string }>("POST", "/today/briefing/seen"),
    onSuccess: () => {
      client.setQueryData<TodayResponse>(TODAY_KEY, (old) => (old ? { ...old, briefingSeen: true } : old));
    },
  });
};

export const usePayments = () =>
  useQuery({ queryKey: PAYMENTS_KEY, queryFn: () => request<PaymentsResponse>("/payments") });

export const useMac = () =>
  useQuery({ queryKey: MAC_KEY, queryFn: () => request<MacResponse>("/mac"), refetchInterval: 60_000 });

// A new sample lands every ten minutes: asking more often would only redraw the same points.
export const useMacHistory = (range: MacRange) =>
  useQuery({
    queryKey: [...MAC_KEY, "history", range],
    queryFn: () => request<MacSample[]>(`/mac/history?range=${range}`),
    refetchInterval: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

// Payments feed Today, so every write refreshes both.
const usePaymentWrite = <V>(fn: (vars: V) => Promise<PaymentsResponse>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      client.setQueryData(PAYMENTS_KEY, data);
      void client.invalidateQueries({ queryKey: TODAY_KEY });
    },
  });
};

export const useMarkPaid = () =>
  usePaymentWrite(({ paymentId, period }: { paymentId: number; period: string }) =>
    send<PaymentsResponse>("POST", `/payments/${paymentId}/paid`, { period }),
  );

export const useUndoPaid = () =>
  usePaymentWrite(({ paymentId, period }: { paymentId: number; period: string }) =>
    send<PaymentsResponse>("DELETE", `/payments/${paymentId}/paid/${period}`),
  );

export const useSavePayment = () =>
  usePaymentWrite(({ id, input }: { id: number | null; input: PaymentInput }) =>
    id === null ? send<PaymentsResponse>("POST", "/payments", input) : send<PaymentsResponse>("PATCH", `/payments/${id}`, input),
  );

export const useDeletePayment = () =>
  usePaymentWrite((id: number) => send<PaymentsResponse>("DELETE", `/payments/${id}`));

export const useMacAction = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cta: MacCta) =>
      cta.kind === "kill"
        ? send<{ ok: true }>("POST", `/mac/processes/${cta.pid}/kill`, { confirm: true })
        : send<{ ok: true }>("POST", "/mac/open", { cta }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: MAC_KEY });
      void client.invalidateQueries({ queryKey: TODAY_KEY });
    },
  });
};

const SESSIONS_KEY = [...MAC_KEY, "sessions"];

export const useClaudeSessions = () =>
  useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => request<ClaudeSessionsResponse>("/mac/sessions"),
    refetchInterval: 60_000,
  });

// "prepare" saves the open sessions; "resume" opens them again in Warp after the restart.
export const useClaudeSessionsAction = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: "prepare" | "resume") => send<ClaudeSessionsResponse>("POST", `/mac/sessions/${action}`),
    onSuccess: (data) => client.setQueryData(SESSIONS_KEY, data),
  });
};

const CLEANUP_KEY = [...MAC_KEY, "cleanup"];

// The last analysis the server kept (null until the first one): analyzing runs only on a click.
export const useCleanup = () =>
  useQuery({ queryKey: CLEANUP_KEY, queryFn: () => request<CleanupReport | null>("/mac/cleanup") });

const useCleanupWrite = <V>(mutationFn: (vars: V) => Promise<CleanupReport>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (report) => {
      client.setQueryData(CLEANUP_KEY, report);
      void client.invalidateQueries({ queryKey: MAC_KEY, exact: true });
    },
  });
};

export const useAnalyzeCleanup = () => useCleanupWrite(() => send<CleanupReport>("POST", "/mac/cleanup/analyze"));

export const useApplyCleanup = () =>
  useCleanupWrite((id: string) => send<CleanupReport>("POST", "/mac/cleanup/apply", { id, confirm: true }));

const MOLE_KEY = [...MAC_KEY, "mole"];

// What Mole last showed (the disk view, the open previews, the last run). Nothing runs until a click.
// It only changes through the mutations below, which put the new report in place: no refetch on focus.
export const useMole = () =>
  useQuery({ queryKey: MOLE_KEY, queryFn: () => request<MoleReport>("/mac/mole"), staleTime: Infinity });

// Only a deletion changes the disk the Mac status shows; previews and the explorer just read.
const useMoleWrite = <V>(mutationFn: (vars: V) => Promise<MoleReport>, deletes = false) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (report) => {
      client.setQueryData(MOLE_KEY, report);
      if (deletes) void client.invalidateQueries({ queryKey: MAC_KEY, exact: true });
    },
    // A refused deletion may have dropped a stale preview on the server: show what it kept.
    onError: () => {
      void client.invalidateQueries({ queryKey: MOLE_KEY });
      if (deletes) void client.invalidateQueries({ queryKey: MAC_KEY, exact: true });
    },
  });
};

// null: the overview of the whole Mac; a path: one of the folders the last view listed.
export const useMoleAnalyze = () => useMoleWrite((path: string | null) => send<MoleReport>("POST", "/mac/mole/analyze", { path }));

export const useMolePreview = (what: "clean" | "installers") =>
  useMoleWrite(() => send<MoleReport>("POST", `/mac/mole/${what}/preview`));

export const useMoleApply = (what: "clean" | "installers") =>
  useMoleWrite((previewId: string) => send<MoleReport>("POST", `/mac/mole/${what}/apply`, { previewId, confirm: true }), true);

// Whether this screen reaches Jarvis through Tailscale (my phone): Mac-only actions and links stay hidden there.
export const useIsRemote = (): boolean =>
  useQuery({
    queryKey: ["whoami"],
    queryFn: () => request<{ remote: boolean }>("/whoami"),
    staleTime: Infinity,
  }).data?.remote ?? true;

export const MAIL_KEY = ["mail"];
export const GOOGLE_KEY = ["google"];

export const useGoogleStatus = () =>
  useQuery({ queryKey: GOOGLE_KEY, queryFn: () => request<GoogleStatus>("/google/status") });

export const useMail = () =>
  useQuery({ queryKey: MAIL_KEY, queryFn: () => request<MailResponse>("/mail"), refetchInterval: FIVE_MIN });

// Each action returns the mailbox read again: put it in place of the old one, and refresh Today.
const useMailboxWrite = <V>(fn: (vars: V) => Promise<MailboxResponse>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (box) => {
      client.setQueryData<MailResponse>(MAIL_KEY, (old) =>
        old ? { mailboxes: old.mailboxes.map((b) => (b.account === box.account ? box : b)) } : old,
      );
      void client.invalidateQueries({ queryKey: TODAY_KEY });
    },
    // A stale snapshot means the list changed: read both again so the next click works.
    onError: () => {
      void client.invalidateQueries({ queryKey: MAIL_KEY });
      void client.invalidateQueries({ queryKey: TODAY_KEY });
    },
  });
};

export const useMailGroupAction = () =>
  useMailboxWrite(
    ({ account, kind, snapshotId, action }: { account: string; kind: MailKind; snapshotId: string; action: MailAction }) =>
      send<MailboxResponse>("POST", `/mail/${encodeURIComponent(account)}/groups/${kind}/${action}`, { snapshotId }),
  );

export const useMailSelectionAction = () =>
  useMailboxWrite(({ account, ids, action }: { account: string; ids: string[]; action: MailAction }) =>
    send<MailboxResponse>("POST", `/mail/${encodeURIComponent(account)}/messages/${action}`, { ids }),
  );

const SWEEP_KEY = [...MAIL_KEY, "sweep"];

// The last Gmail sweep the server kept (null until the first one): it reads hundreds of messages, so only on a click.
export const useMailSweep = () =>
  useQuery({ queryKey: SWEEP_KEY, queryFn: () => request<SweepReport | null>("/mail/sweep") });

const useSweepWrite = <V>(mutationFn: (vars: V) => Promise<SweepReport>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (report) => {
      client.setQueryData(SWEEP_KEY, report);
      void client.invalidateQueries({ queryKey: MAIL_KEY, exact: true });
      void client.invalidateQueries({ queryKey: TODAY_KEY });
    },
  });
};

export const useAnalyzeMailSweep = () => useSweepWrite(() => send<SweepReport>("POST", "/mail/sweep/analyze"));

export const useApplyMailSweep = () =>
  useSweepWrite((request: SweepApply) => send<SweepReport>("POST", "/mail/sweep/apply", { ...request, confirm: true }));

export const useNotPerson = () =>
  useMailboxWrite(({ account, messageId }: { account: string; messageId: string }) =>
    send<MailboxResponse>("POST", `/mail/${encodeURIComponent(account)}/messages/${messageId}/not-a-person`),
  );

type TaskRef = { account: string; listId: string; taskId: string };

const taskPath = ({ account, listId, taskId }: TaskRef): string =>
  `/tasks/${encodeURIComponent(account)}/${encodeURIComponent(listId)}/${encodeURIComponent(taskId)}`;

export const useCompleteTask = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ref: TaskRef) => send<AgendaResponse>("POST", `${taskPath(ref)}/complete`),
    // The answer is the agenda read again: show it in Today's side column now, then refresh the cards.
    onSuccess: (agenda) => {
      client.setQueryData<TodayResponse>(TODAY_KEY, (old) => (old ? { ...old, side: { ...old.side, agenda } } : old));
      void client.invalidateQueries({ queryKey: TODAY_KEY });
      void client.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
};

export const TASKS_KEY = ["tasks"];

export const useTasks = () => useQuery({ queryKey: TASKS_KEY, queryFn: () => request<TasksResponse>("/tasks") });

// Every task write answers with the tasks read again; Today's cards and agenda show the same tasks.
const useTaskWrite = <V>(fn: (vars: V) => Promise<TasksResponse>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (tasks) => {
      client.setQueryData(TASKS_KEY, tasks);
      void client.invalidateQueries({ queryKey: TODAY_KEY });
    },
  });
};

export const useCreateTask = () => useTaskWrite((input: TaskCreate) => send<TasksResponse>("POST", "/tasks", input));

export const useUpdateTask = () =>
  useTaskWrite(({ change, ...ref }: TaskRef & { change: TaskUpdate }) => send<TasksResponse>("PATCH", taskPath(ref), change));

export const usePostponeTask = () =>
  useTaskWrite(({ days, ...ref }: TaskRef & { days: PostponeDays }) =>
    send<TasksResponse>("POST", `${taskPath(ref)}/postpone`, { days }),
  );

export const useDeleteTask = () =>
  useTaskWrite(({ series, ...ref }: TaskRef & { series: boolean }) =>
    send<TasksResponse>("DELETE", `${taskPath(ref)}${series ? "?series=true" : ""}`),
  );

export const useStopRule = () => useTaskWrite((id: number) => send<TasksResponse>("DELETE", `/tasks/rules/${id}`));

export const useDisconnectGoogle = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => send<GoogleStatus>("DELETE", `/google/accounts/${encodeURIComponent(email)}`),
    onSuccess: (status) => {
      client.setQueryData(GOOGLE_KEY, status);
      void client.invalidateQueries({ queryKey: MAIL_KEY });
      void client.invalidateQueries({ queryKey: TODAY_KEY });
      void client.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
};

export const WALLET_KEY = ["wallet"];
export const NEWS_KEY = ["news"];
export const RESEARCH_KEY = ["research"];

export const useWallet = () =>
  useQuery({ queryKey: WALLET_KEY, queryFn: () => request<WalletResponse>("/wallet"), refetchInterval: FIVE_MIN });

export const useWalletHistory = (range: HistoryRange) =>
  useQuery({
    queryKey: [...WALLET_KEY, "history", range],
    queryFn: () => request<WalletHistory>(`/wallet/history?range=${range}`),
    refetchInterval: FIVE_MIN,
    placeholderData: keepPreviousData,
  });

// Yahoo's closes: the server keeps them for hours, so the page never asks again on its own.
export const usePositionHistory = (symbol: string, range: HistoryRange) =>
  useQuery({
    queryKey: [...WALLET_KEY, "history", "position", symbol, range],
    queryFn: () => request<PositionHistory>(`/wallet/history/${encodeURIComponent(symbol)}?range=${range}`),
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });

// Every wallet write answers with the wallet read again; Today shows its alerts, so it refreshes too.
const useWalletWrite = <V>(fn: (vars: V) => Promise<WalletResponse>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (wallet) => {
      client.setQueryData(WALLET_KEY, wallet);
      void client.invalidateQueries({ queryKey: TODAY_KEY });
      // New prices are today's point of the history; a new level is a line on its position's chart.
      void client.invalidateQueries({ queryKey: [...WALLET_KEY, "history"] });
    },
  });
};

export const useWalletRefresh = () =>
  useWalletWrite((what: "prices" | "flex") => send<WalletResponse>("POST", `/wallet/refresh?what=${what}`));

export const useAddLevel = () => useWalletWrite((input: LevelInput) => send<WalletResponse>("POST", "/wallet/levels", input));

export const useDeleteLevel = () => useWalletWrite((id: number) => send<WalletResponse>("DELETE", `/wallet/levels/${id}`));

export const useNews = (topic: NewsTopic | null) =>
  useQuery({
    queryKey: [...NEWS_KEY, topic],
    queryFn: () => request<NewsResponse>(topic ? `/news?topic=${topic}` : "/news"),
    refetchInterval: 10 * 60_000,
  });

export const useNewsRefresh = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => send<NewsResponse>("POST", "/news/refresh"),
    onSuccess: () => void client.invalidateQueries({ queryKey: NEWS_KEY }),
  });
};

// Polled only while something is running: an agent run takes minutes, not seconds.
export const useResearchList = () =>
  useQuery({
    queryKey: RESEARCH_KEY,
    queryFn: () => request<ResearchList>("/research"),
    refetchInterval: (query) => (query.state.data?.runs.some((r) => r.status === "running") ? 5000 : false),
  });

export const useResearch = (id: number | null) =>
  useQuery({
    queryKey: [...RESEARCH_KEY, id],
    queryFn: () => request<ResearchDetail>(`/research/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5000 : false),
  });

export const useStartResearch = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ResearchInput) => send<ResearchRun>("POST", "/research", input),
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: RESEARCH_KEY });
      window.location.hash = `analisis/${run.id}`;
    },
  });
};

export const useSaveResearch = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => send<ResearchDetail>("POST", `/research/${id}/save`),
    onSuccess: (detail) => {
      client.setQueryData([...RESEARCH_KEY, detail.id], detail);
      void client.invalidateQueries({ queryKey: RESEARCH_KEY });
    },
  });
};

// A file I may also edit outside Jarvis: read again on every visit, but never swapped under an open editor on focus.
const FRESH_FILE = { staleTime: 0, refetchOnWindowFocus: false } as const;

export const NOTES_KEY = ["notes"];

export const useNotes = () => useQuery({ queryKey: NOTES_KEY, queryFn: () => request<NotesList>("/notes") });

export const useNote = (path: string | null) =>
  useQuery({
    queryKey: [...NOTES_KEY, "file", path],
    queryFn: () => request<NoteFile>(`/notes/file?path=${encodeURIComponent(path ?? "")}`),
    enabled: path !== null,
    ...FRESH_FILE,
  });

export const useNoteSearch = (q: string) =>
  useQuery({
    queryKey: [...NOTES_KEY, "search", q],
    queryFn: () => request<NoteSearchHit[]>(`/notes/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  });

export const useSaveNote = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note: NoteSave) => send<NoteFile>("PUT", "/notes/file", note),
    onSuccess: (note) => {
      client.setQueryData([...NOTES_KEY, "file", note.path], note);
      void client.invalidateQueries({ queryKey: NOTES_KEY, exact: true });
    },
  });
};

export const useDeleteNote = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note: NoteFile) =>
      send<{ ok: true }>("DELETE", `/notes/file?path=${encodeURIComponent(note.path)}&mtimeMs=${note.mtimeMs}`),
    // The list and any search that found it; the note itself is gone, so its query goes too.
    onSuccess: (_, note) => {
      client.removeQueries({ queryKey: [...NOTES_KEY, "file", note.path] });
      void client.invalidateQueries({ queryKey: NOTES_KEY });
    },
  });
};

export const useCreateNote = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note: NoteCreate) => send<NoteFile>("POST", "/notes/file", note),
    onSuccess: () => void client.invalidateQueries({ queryKey: NOTES_KEY, exact: true }),
  });
};

export const STATEMENTS_KEY = ["statements"];

const SPENDING_KEY = [...STATEMENTS_KEY, "spending"];

export const useSpending = () => useQuery({ queryKey: SPENDING_KEY, queryFn: () => request<SpendingResponse>("/statements/spending") });

export const useStatementCsvs = () =>
  useQuery({ queryKey: STATEMENTS_KEY, queryFn: () => request<StatementCsvFile[]>("/statements") });

export const useStatementCsv = (file: string | null) =>
  useQuery({
    queryKey: [...STATEMENTS_KEY, "csv", file],
    queryFn: () => request<StatementCsv>(`/statements/csv?file=${encodeURIComponent(file ?? "")}`),
    enabled: file !== null,
    ...FRESH_FILE,
  });

export const useImportStatement = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<StatementImport>("/statements/import", { method: "POST", body: form });
    },
    // An import may replace the CSV that is open, not only add to the list.
    onSuccess: () => void client.invalidateQueries({ queryKey: STATEMENTS_KEY }),
  });
};

export const useSaveStatementCsv = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (save: StatementCsvSave) => send<StatementCsv>("PUT", "/statements/csv", save),
    onSuccess: (csv) => {
      client.setQueryData([...STATEMENTS_KEY, "csv", csv.file], csv);
      void client.invalidateQueries({ queryKey: STATEMENTS_KEY, exact: true });
      void client.invalidateQueries({ queryKey: SPENDING_KEY });
    },
  });
};

export const useRevealStatementCsv = () =>
  useMutation({ mutationFn: (file: string) => send<{ ok: true }>("POST", "/statements/reveal", { file }) });
