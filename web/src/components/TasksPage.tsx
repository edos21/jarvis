import { ExternalLink, Repeat as RepeatIcon } from "lucide-react";
import { useRef, useState } from "react";

import { localDate } from "../../../shared/dates";
import {
  REPEAT_UNITS,
  type Repeat,
  type RepeatUnit,
  type TaskEntry,
  type TaskList,
  type TaskRule,
  repeatLabel,
} from "../../../shared/tasks";
import { useCompleteTask, useCreateTask, useDeleteTask, useIsRemote, useStopRule, useTasks, useUpdateTask } from "@/lib/api";
import { dayToMs, shortDay } from "@/lib/format";
import { Button, MutationButton, fieldBase } from "./Button";
import { Heading } from "./Heading";
import { PostponeButton } from "./PostponeButton";
import { StatusText } from "./Status";
import { TaskCheck } from "./TaskCheck";

type RepeatChoice = "none" | RepeatUnit | "custom";

const REPEAT_CHOICES: { value: RepeatChoice; label: string }[] = [
  { value: "none", label: "No se repite" },
  { value: "day", label: "Cada día" },
  { value: "week", label: "Cada semana" },
  { value: "month", label: "Cada mes" },
  { value: "year", label: "Cada año" },
  { value: "custom", label: "Personalizado…" },
];

const UNIT_PLURAL: Record<RepeatUnit, string> = { day: "días", week: "semanas", month: "meses", year: "años" };

const listKey = (l: Pick<TaskList, "account" | "id">): string => `${l.account}|${l.id}`;

const NewTask = ({ lists }: { lists: TaskList[] }) => {
  const create = useCreateTask();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [list, setList] = useState(lists[0] ? listKey(lists[0]) : "");
  const [choice, setChoice] = useState<RepeatChoice>("none");
  const [every, setEvery] = useState(2);
  const [unit, setUnit] = useState<RepeatUnit>("week");
  const target = lists.find((l) => listKey(l) === list) ?? lists[0];
  if (!target) return null;
  const repeat: Repeat | null =
    choice === "none" ? null : choice === "custom" ? { every, unit } : { every: 1, unit: choice };
  return (
    <form
      className="grid gap-2 rounded-lg border border-line bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          { account: target.account, listId: target.id, title, due: due || null, repeat },
          {
            onSuccess: () => {
              setTitle("");
              setDue("");
              setChoice("none");
            },
          },
        );
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Nueva tarea"
          className={`${fieldBase} min-w-0 flex-1 basis-56`}
          placeholder="Nueva tarea"
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
        <input aria-label="Fecha" type="date" className={fieldBase} value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Repetir" className={fieldBase} value={choice} onChange={(e) => setChoice(e.target.value as RepeatChoice)}>
          {REPEAT_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {choice === "custom" && (
          <span className="inline-flex items-center gap-1.5 text-meta text-muted">
            cada
            <input
              aria-label="Cada cuántos"
              type="number"
              min={1}
              max={365}
              className={`${fieldBase} w-16`}
              value={every}
              onChange={(e) => setEvery(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
            />
            <select aria-label="Unidad" className={fieldBase} value={unit} onChange={(e) => setUnit(e.target.value as RepeatUnit)}>
              {REPEAT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_PLURAL[u]}
                </option>
              ))}
            </select>
          </span>
        )}
        {lists.length > 1 && (
          <select aria-label="Lista" className={fieldBase} value={list} onChange={(e) => setList(e.target.value)}>
            {lists.map((l) => (
              <option key={listKey(l)} value={listKey(l)}>
                {l.title}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        {repeat && !due && <span className="text-meta text-muted">Empieza hoy</span>}
        <MutationButton type="submit" variant="primary" mutation={create}>
          Agregar
        </MutationButton>
      </div>
    </form>
  );
};

const DeleteControl = ({ task, onCancel }: { task: TaskEntry; onCancel: () => void }) => {
  const remove = useDeleteTask();
  const ref = { account: task.account, listId: task.listId, taskId: task.id };
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-meta text-muted">
      {task.ruleId !== null ? (
        <>
          <MutationButton variant="danger" mutation={remove} onClick={() => remove.mutate({ ...ref, series: false })}>
            Solo esta
          </MutationButton>
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate({ ...ref, series: true })}>
            Toda la serie
          </Button>
        </>
      ) : (
        <>
          <MutationButton variant="danger" mutation={remove} onClick={() => remove.mutate({ ...ref, series: false })}>
            Sí, borrar
          </MutationButton>
          <span>Si se repite desde Google Tasks, quita la repetición allá.</span>
        </>
      )}
      <Button onClick={onCancel}>No</Button>
    </span>
  );
};

const TaskRow = ({ task, rule, remote }: { task: TaskEntry; rule: TaskRule | undefined; remote: boolean }) => {
  const complete = useCompleteTask();
  const update = useUpdateTask();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [deleting, setDeleting] = useState(false);
  // Escape unmounts the field, which blurs it: the blur that follows must not save what was just cancelled.
  const cancelled = useRef(false);
  const ref = { account: task.account, listId: task.listId, taskId: task.id };
  const saveTitle = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(task.title);
      return;
    }
    const title = draft.trim();
    if (title && title !== task.title) update.mutate({ ...ref, change: { title } });
    else setDraft(task.title);
  };
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-2 border-b border-line py-2 last:border-b-0 max-sm:grid-cols-[1.75rem_1fr]">
      <TaskCheck title={task.title} disabled={complete.isPending} onClick={() => complete.mutate(ref)} className="mt-1" />
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {editing ? (
            <input
              aria-label="Título"
              autoFocus
              className={`${fieldBase} min-w-0 flex-1`}
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                // Blurring saves: Enter and leaving the field go through the same single save.
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  cancelled.current = true;
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <button type="button" title="Editar título" className="min-w-0 text-left text-body hover:text-accent max-sm:min-h-11" onClick={() => {
                setDraft(task.title);
                setEditing(true);
              }}>
              {task.title}
            </button>
          )}
          {rule && (
            <span className="inline-flex items-center gap-1 text-meta text-muted">
              <RepeatIcon size={12} aria-hidden />
              {repeatLabel(rule.repeat)}
            </span>
          )}
          <a href={task.url} target="_blank" rel="noreferrer" title="Abrir en Google Tasks" className="text-muted hover:text-accent max-sm:grid max-sm:size-11 max-sm:place-items-center">
            <ExternalLink size={13} className="max-sm:size-4" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 max-sm:gap-2">
          <input
            aria-label="Fecha"
            type="date"
            className={`${fieldBase} py-1 text-body`}
            // Saved on leaving the field: while the year is typed, the field passes through 0002, 0020, 0202.
            key={task.due ?? "none"}
            defaultValue={task.due ?? ""}
            onBlur={(e) => {
              const due = e.target.value || null;
              if (due !== task.due) update.mutate({ ...ref, change: { due } });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <PostponeButton {...ref} />
          {!remote &&
            (deleting ? (
              <DeleteControl task={task} onCancel={() => setDeleting(false)} />
            ) : (
              <Button onClick={() => setDeleting(true)}>Borrar</Button>
            ))}
        </div>
        {(complete.error ?? update.error) && (
          <span className="text-meta text-critical">{(complete.error ?? update.error)?.message}</span>
        )}
      </div>
    </li>
  );
};

const GROUPS = [
  { key: "overdue", label: "Vencidas" },
  { key: "today", label: "Hoy" },
  { key: "upcoming", label: "Próximas" },
  { key: "undated", label: "Sin fecha" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

const groupOf = (due: string | null, today: string): GroupKey =>
  due === null ? "undated" : due < today ? "overdue" : due === today ? "today" : "upcoming";

const Rules = ({ rules, remote }: { rules: TaskRule[]; remote: boolean }) => {
  const stop = useStopRule();
  if (rules.length === 0) return null;
  return (
    <section>
      <Heading>Se repiten</Heading>
      <ul className="grid gap-1.5">
        {rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-body">
            <span>
              {r.title}{" "}
              <span className="text-meta text-muted">
                · {repeatLabel(r.repeat)}
                {r.currentDue && ` · la actual vence el ${shortDay(dayToMs(r.currentDue))}`}
              </span>
            </span>
            {!remote && (
              <MutationButton mutation={stop} onClick={() => stop.mutate(r.id)}>
                Dejar de repetir
              </MutationButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

export const TasksPage = () => {
  const { data, error, isLoading } = useTasks();
  const remote = useIsRemote();
  if (isLoading) return <p className="p-8 text-muted">Leyendo tus tareas…</p>;
  if (error || !data) return <p className="p-8 text-critical">No pude leer tus tareas: {error?.message}</p>;
  const today = localDate(new Date());
  const rules = new Map(data.rules.map((r) => [r.id, r]));
  const sorted = [...data.tasks].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title));
  return (
    <main className="mx-auto grid max-w-3xl content-start gap-6 px-5 py-6 sm:px-8 sm:py-8">
      <header>
        <h1 className="font-serif text-[28px] leading-tight">Tareas</h1>
        <p className="text-body text-muted">Tus pendientes de Google Tasks. Lo que cambies aquí se ve también en Google.</p>
      </header>
      {data.reconnect.length > 0 && (
        <p className="text-body">
          <StatusText severity="warning">
            <span>
              Reconecta tu Google en <a className="underline" href="#correo">Correo</a> para ver todas tus tareas.
            </span>
          </StatusText>
        </p>
      )}
      {data.lists.length === 0 ? (
        <p className="text-body text-muted">
          Conecta tu Google en <a className="underline" href="#correo">Correo</a> para ver tus tareas.
        </p>
      ) : (
        <NewTask lists={data.lists} />
      )}
      {sorted.length === 0 && data.lists.length > 0 && <p className="text-body text-muted">No tienes tareas pendientes.</p>}
      {GROUPS.map((g) => {
        const tasks = sorted.filter((t) => groupOf(t.due, today) === g.key);
        if (tasks.length === 0) return null;
        return (
          <section key={g.key}>
            <Heading>
              {g.label} · {tasks.length}
            </Heading>
            <ul className="rounded-lg border border-line bg-surface px-3">
              {tasks.map((t) => (
                <TaskRow key={`${t.account}/${t.id}`} task={t} rule={t.ruleId === null ? undefined : rules.get(t.ruleId)} remote={remote} />
              ))}
            </ul>
          </section>
        );
      })}
      <Rules rules={data.rules} remote={remote} />
    </main>
  );
};
