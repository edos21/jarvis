import type { AgendaResponse, TaskItem } from "../../../shared/calendar";
import { useCompleteTask, useGoogleStatus } from "@/lib/api";
import { timeOf } from "@/lib/format";
import { StatusText } from "./Status";
import { TaskCheck } from "./TaskCheck";

const TaskRow = ({ task }: { task: TaskItem }) => {
  const complete = useCompleteTask();
  return (
    <li className="grid grid-cols-[1.75rem_1fr] items-start py-1 text-body max-sm:grid-cols-[2.25rem_1fr] max-sm:py-0">
      <TaskCheck
        title={task.title}
        disabled={complete.isPending}
        onClick={() => complete.mutate({ account: task.account, listId: task.listId, taskId: task.id })}
        className="mt-0.5"
      />
      <span>
        <a href={task.url} target="_blank" rel="noreferrer" className="hover:text-accent max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">
          {task.title}
        </a>
        {task.overdue && (
          <StatusText severity="warning" className="ml-1.5 text-meta">
            vencida
          </StatusText>
        )}
        {complete.error && <span className="block text-meta text-critical">{complete.error.message}</span>}
      </span>
    </li>
  );
};

const NONE: ReadonlySet<string> = new Set();

// hideTasks: tasks Today already shows as cards, left out here so each one has a single "done" control.
export const AgendaBlock = ({ agenda, hideTasks = NONE }: { agenda: AgendaResponse | null; hideTasks?: ReadonlySet<string> }) => {
  const { data: google } = useGoogleStatus();
  if (google && (!google.configured || google.accounts.length === 0)) {
    return (
      <p className="text-meta text-muted">
        Conecta tu Google en <a className="underline" href="#correo">Correo</a> para ver tu agenda.
      </p>
    );
  }
  if (!agenda) return <p className="text-meta text-muted">No se pudo leer la agenda.</p>;
  const tasks = agenda.tasks.filter((t) => !hideTasks.has(t.id));
  const empty = agenda.items.length === 0 && tasks.length === 0;
  return (
    <>
      {agenda.reconnect.length > 0 && (
        <p className="mb-1 text-body">
          <StatusText severity="warning">
            <span>
              Reconecta tu Google en <a className="underline" href="#correo">Correo</a> para ver tu agenda y tus tareas.
            </span>
          </StatusText>
        </p>
      )}
      {empty && agenda.reconnect.length === 0 && <p className="text-meta text-muted">Nada en la agenda hoy.</p>}
      {agenda.items.length > 0 && (
        <ul>
          {agenda.items.map((item) => (
            <li key={item.id} className="grid grid-cols-[5.5rem_1fr] py-1 text-body max-sm:items-center max-sm:py-0">
              <span className="whitespace-nowrap text-muted [font-variant-numeric:tabular-nums]">
                {item.allDay ? "Todo" : timeOf(item.start)}
              </span>
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-accent max-sm:flex max-sm:min-h-11 max-sm:items-center">
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 0 && (
        <ul className={agenda.items.length > 0 ? "mt-2 border-t border-line pt-2" : ""}>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
    </>
  );
};
