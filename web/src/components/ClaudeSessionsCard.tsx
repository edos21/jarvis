import type { ClaudeSession } from "../../../shared/mac";
import { useClaudeSessions, useClaudeSessionsAction } from "@/lib/api";
import { dateTimeOf } from "@/lib/format";
import { MutationButton } from "./Button";
import { Heading } from "./Heading";

// The last two folders say which project it is; the full path would only repeat my home.
const shortPath = (cwd: string): string => cwd.split("/").filter(Boolean).slice(-2).join("/");

const SessionList = ({ sessions }: { sessions: ClaudeSession[] }) => (
  <ul className="grid gap-1 text-body">
    {sessions.map((s) => (
      <li key={s.sessionId} className="flex items-baseline justify-between gap-3">
        <span className="truncate">{s.name ?? shortPath(s.cwd)}</span>
        <span className="shrink-0 font-mono text-meta text-muted">{shortPath(s.cwd)}</span>
      </li>
    ))}
  </ul>
);

// Restarting ends the Claude Code processes, not their conversations: this saves which ones were open and brings
// them back in Warp afterwards.
export const ClaudeSessionsCard = () => {
  const { data, error } = useClaudeSessions();
  const action = useClaudeSessionsAction();
  if (error) return <p className="text-body text-critical">No pude leer las sesiones de Claude Code: {error.message}</p>;
  if (!data) return null;
  const { open, preparedAt, toResume } = data;
  return (
    <section className="grid gap-3 rounded-lg border border-line bg-surface p-4">
      <Heading className="">Antes de reiniciar</Heading>
      {toResume.length > 0 ? (
        <>
          <p className="text-body">
            El {dateTimeOf(preparedAt ?? "")} guardaste{" "}
            {toResume.length === 1 ? "1 sesión" : `${toResume.length} sesiones`} de Claude Code. Cada una vuelve en su
            propia pestaña de Warp, con su conversación.
          </p>
          <SessionList sessions={toResume} />
          <div className="flex flex-wrap gap-2">
            <MutationButton variant="primary" mutation={action} onClick={() => action.mutate("resume")}>
              Retomar en Warp
            </MutationButton>
            <MutationButton mutation={action} onClick={() => action.mutate("prepare")}>
              Guardar las abiertas de nuevo
            </MutationButton>
          </div>
        </>
      ) : open.length === 0 ? (
        <p className="text-body text-muted">No hay sesiones de Claude Code abiertas.</p>
      ) : (
        <>
          <p className="text-body">
            {open.length === 1 ? "1 sesión" : `${open.length} sesiones`} de Claude Code abiertas.{" "}
            {preparedAt
              ? `Guardadas el ${dateTimeOf(preparedAt)}: reinicia cuando quieras y al volver toca Retomar aquí.`
              : "Guárdalas antes de reiniciar para retomarlas después en Warp."}
          </p>
          <SessionList sessions={open} />
          <div>
            <MutationButton variant={preparedAt ? "plain" : "primary"} mutation={action} onClick={() => action.mutate("prepare")}>
              {preparedAt ? "Guardar de nuevo" : "Preparar reinicio"}
            </MutationButton>
          </div>
        </>
      )}
    </section>
  );
};
