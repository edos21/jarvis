import { useState } from "react";

import { type MailAction, type MailGroup, type MailboxResponse, automatedEntryFor, canTrashGroup } from "../../../shared/mail";
import { useIsRemote, useMail, useMailGroupAction, useMailSelectionAction } from "@/lib/api";
import { timeOf } from "@/lib/format";
import { useIsPhone } from "@/lib/phone";
import { Button, LinkButton } from "./Button";
import { GoogleConnect } from "./GoogleConnect";
import { MailSweepCard } from "./MailSweepCard";
import { NotPersonButton } from "./NotPersonButton";

const GROUP_LABEL = {
  person: "Personas",
  invoice: "Facturas",
  notification: "Notificaciones",
  newsletter: "Newsletters",
} as const;

const STICKY_ON_PHONE =
  "max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:rounded-t-lg max-sm:border-b max-sm:border-line max-sm:bg-surface";

// With a selection, its actions; otherwise the whole group's, where trashing everything asks first.
const GroupActions = ({
  group,
  selected,
  busy,
  onGroup,
  onSelected,
  onClear,
}: {
  group: MailGroup;
  selected: string[];
  busy: boolean;
  onGroup: (action: MailAction) => void;
  onSelected: (action: MailAction) => void;
  onClear: () => void;
}) => {
  const [confirmingTrash, setConfirmingTrash] = useState(false);

  if (selected.length > 0) {
    if (confirmingTrash) setConfirmingTrash(false);
    return (
      <>
        <span className="text-meta text-muted">
          {selected.length} {selected.length === 1 ? "seleccionado" : "seleccionados"}
        </span>
        <Button onClick={() => onSelected("read")} disabled={busy}>
          Marcar leído
        </Button>
        <Button onClick={() => onSelected("archive")} disabled={busy}>
          Archivar
        </Button>
        <Button variant="danger" onClick={() => onSelected("trash")} disabled={busy}>
          A la papelera
        </Button>
        <Button onClick={onClear}>Cancelar</Button>
      </>
    );
  }

  const markRead = (
    <Button onClick={() => onGroup("read")} disabled={busy}>
      Marcar leído
    </Button>
  );
  if (!canTrashGroup(group.kind)) {
    return (
      <>
        {markRead}
        <Button variant={group.kind === "person" ? "plain" : "primary"} onClick={() => onGroup("archive")} disabled={busy}>
          Archivar todo
        </Button>
      </>
    );
  }
  if (confirmingTrash) {
    return (
      <>
        {markRead}
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            setConfirmingTrash(false);
            onGroup("trash");
          }}
        >
          Sí, {group.items.length} a la papelera
        </Button>
        <Button onClick={() => setConfirmingTrash(false)}>No</Button>
      </>
    );
  }
  return (
    <>
      {markRead}
      <Button variant="primary" onClick={() => setConfirmingTrash(true)} disabled={busy}>
        Todo a la papelera
      </Button>
    </>
  );
};

const Group = ({ box, group }: { box: MailboxResponse; group: MailGroup }) => {
  // People come first and open; machine mail stays folded until asked for.
  const [open, setOpen] = useState(group.kind === "person");
  const phone = useIsPhone();
  // On the phone a row shows its actions only once tapped, one row at a time; the checkbox still selects.
  const [shownRow, setShownRow] = useState<string | null>(null);
  const act = useMailGroupAction();
  const select = useMailSelectionAction();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // A message that left the group (archived from Gmail, moved by "No es una persona") drops out of the selection.
  const selected = group.items.filter((i) => picked.has(i.id)).map((i) => i.id);
  const busy = act.isPending || select.isPending;

  const run = (action: MailAction) =>
    act.mutate({ account: box.account, kind: group.kind, snapshotId: box.snapshotId, action });
  const runOn = (ids: string[], action: MailAction) =>
    select.mutate({ account: box.account, ids, action }, { onSuccess: () => setPicked(new Set()) });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const error = act.error ?? select.error;

  return (
    <section className="rounded-lg border border-line bg-surface">
      {/* While something is picked, its actions ride along at the top of the screen on the phone. */}
      <header
        className={`flex flex-wrap items-center gap-2 px-4 py-3 ${selected.length > 0 ? STICKY_ON_PHONE : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 text-left text-body font-semibold max-sm:min-h-11"
        >
          {GROUP_LABEL[group.kind]} <span className="font-mono text-meta text-muted">{group.items.length}</span>
        </button>
        <GroupActions
          group={group}
          selected={selected}
          busy={busy}
          onGroup={run}
          onSelected={(action) => runOn(selected, action)}
          onClear={() => setPicked(new Set())}
        />
      </header>
      {error && <p className="px-4 pb-2 text-body text-critical">{error.message}</p>}
      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {group.items.map((item) => {
            const isPicked = picked.has(item.id);
            const entry = group.kind === "person" ? automatedEntryFor(item.from) : null;
            const shown = !phone || shownRow === item.id;
            const text = (
              <>
                <span className="block truncate text-body font-medium">{item.fromName}</span>
                <span className="block truncate text-body text-muted">{item.subject}</span>
              </>
            );
            return (
              <li
                key={item.id}
                // A click anywhere on the row selects it; its own buttons and links keep their meaning. The checkbox's label
                // counts too: a tap on it already reaches the input, and selecting here as well would undo that.
                onClick={(e) => {
                  if (!phone && !(e.target as HTMLElement).closest("a, button, input, label")) toggle(item.id);
                }}
                className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 ${isPicked ? "bg-accent/10" : ""}`}
              >
                <label className="grid size-4 place-items-center max-sm:-ml-3.5 max-sm:size-11">
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => toggle(item.id)}
                    aria-label={`Seleccionar: ${item.fromName}, ${item.subject}`}
                    className="size-4 accent-[var(--accent)]"
                  />
                </label>
                {phone ? (
                  <button
                    type="button"
                    aria-expanded={shown}
                    onClick={() => setShownRow((r) => (r === item.id ? null : item.id))}
                    className="min-w-0 flex-1 text-left"
                  >
                    {text}
                  </button>
                ) : (
                  <div className="min-w-0 flex-1 basis-56">{text}</div>
                )}
                <span className="whitespace-nowrap text-meta text-muted [font-variant-numeric:tabular-nums]">{timeOf(item.date)}</span>
                <div className={`flex flex-wrap gap-1.5 max-sm:basis-full max-sm:gap-2 ${shown ? "" : "hidden"}`}>
                  <LinkButton href={item.url}>Abrir</LinkButton>
                  {entry && <NotPersonButton account={box.account} messageId={item.id} entry={entry} />}
                  {!canTrashGroup(group.kind) && (
                    <Button disabled={busy} onClick={() => runOn([item.id], "archive")}>
                      Archivar
                    </Button>
                  )}
                  <Button variant="danger" disabled={busy} onClick={() => runOn([item.id], "trash")}>
                    A la papelera
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export const MailPage = () => {
  const { data, error, isLoading } = useMail();
  const remote = useIsRemote();
  return (
    <main className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] content-start gap-5 px-5 py-6 sm:px-8 sm:py-8">
      <header>
        <h1 className="font-serif text-[28px] leading-tight">Correo</h1>
        <p className="text-body text-muted">Lo sin leer, por quién te escribe. Gmail guarda la papelera 30 días.</p>
      </header>
      <GoogleConnect />
      {isLoading && <p className="text-muted">Leyendo tu correo…</p>}
      {error && <p className="text-critical">No pude leer el correo: {error.message}</p>}
      {data?.mailboxes.map((box) =>
        box.reconnect ? (
          <div key={box.account} className="rounded-lg border border-line bg-surface p-4 text-body">
            <p className="font-semibold">Jarvis perdió el acceso a {box.account}.</p>
            {!remote && (
              <a className="text-accent underline" href="/api/google/connect?kind=personal">
                Reconectar
              </a>
            )}
          </div>
        ) : box.groups.length === 0 ? (
          <p key={box.account} className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-muted">
            Bandeja al día en {box.account}.
          </p>
        ) : (
          <div key={box.account} className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {data.mailboxes.length > 1 && <h2 className="text-meta text-muted">{box.account}</h2>}
            {box.groups.map((g) => (
              <Group key={g.kind} box={box} group={g} />
            ))}
          </div>
        ),
      )}
      {/* Cleaning up is a chore for later: the people who wrote come first. */}
      {data?.mailboxes.some((b) => !b.reconnect) && <MailSweepCard />}
    </main>
  );
};
