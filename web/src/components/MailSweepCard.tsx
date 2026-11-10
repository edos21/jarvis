import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { SweepApply, SweepCategory, SweepOutcome, SweepReport, SweepSender } from "../../../shared/mail";
import { useAnalyzeMailSweep, useApplyMailSweep, useIsRemote, useMailSweep } from "@/lib/api";
import { count, timeOf } from "@/lib/format";
import { Button, MutationButton, touchTarget } from "./Button";
import { Heading } from "./Heading";

const TAB: Record<SweepCategory, string> = { promotions: "Promociones", updates: "Notificaciones" };


const outcomeText = (outcome: SweepOutcome): string => {
  switch (outcome.kind) {
    case "trashed":
      return outcome.count === 1
        ? "Mandaste 1 correo a la papelera. Se recupera desde Gmail durante 30 días."
        : `Mandaste ${count(outcome.count)} correos a la papelera. Se recuperan desde Gmail durante 30 días.`;
    case "archived":
      return outcome.count === 1
        ? "Archivaste 1 correo: sigue en Gmail, fuera del inbox."
        : `Archivaste ${count(outcome.count)} correos: siguen en Gmail, fuera del inbox.`;
    case "unsubscribed":
      return `Listo, pediste la baja de ${outcome.name}. Puede tardar unos días en dejar de escribirte.`;
    case "filtered":
      return `Creé el filtro para ${outcome.name}. Lo ves o lo borras en Gmail, en Configuración → Filtros.`;
  }
};

type Apply = ReturnType<typeof useApplyMailSweep>;

// One confirm per row: the button that was clicked turns into "Sí, …" and "No".
type Pending = { request: SweepApply; label: string } | null;

const Confirm = ({ pending, apply, onCancel }: { pending: NonNullable<Pending>; apply: Apply; onCancel: () => void }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5 max-sm:gap-2">
    <Button variant="danger" disabled={apply.isPending} onClick={() => apply.mutate(pending.request, { onSettled: onCancel })}>
      {apply.isPending ? "Trabajando…" : pending.label}
    </Button>
    <Button disabled={apply.isPending} onClick={onCancel}>
      No
    </Button>
  </span>
);

const Row = ({
  title,
  detail,
  note,
  apply,
  id,
  stacked = false,
  shown = true,
  onToggle,
  children,
}: {
  title: string;
  detail: string;
  note?: string;
  apply: Apply;
  id: string;
  // The actions go under the text on every row, not beside it where a short address leaves room.
  stacked?: boolean;
  // A row with many actions keeps them behind a tap on its text, one open row at a time.
  shown?: boolean;
  onToggle?: () => void;
  children: (ask: (p: NonNullable<Pending>) => void) => ReactNode;
}) => {
  const [pending, setPending] = useState<Pending>(null);
  const mine = apply.variables?.id === id;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2">
      <div className="min-w-0 flex-1 basis-60">
        {onToggle ? (
          <button type="button" aria-expanded={shown} onClick={onToggle} className={`block w-full text-left ${touchTarget}`}>
            <span className="block text-body font-medium">{title}</span>
            <span className="block text-meta text-muted">{detail}</span>
          </button>
        ) : (
          <>
            <p className="text-body font-medium">{title}</p>
            <p className="text-meta text-muted">{detail}</p>
          </>
        )}
        {pending && note && <p className="text-meta text-critical">{note}</p>}
        {mine && apply.error && <p className="text-meta text-critical">{apply.error.message}</p>}
      </div>
      {pending ? (
        <Confirm pending={pending} apply={apply} onCancel={() => setPending(null)} />
      ) : (
        shown && <div className={`grid gap-1.5 ${stacked ? "basis-full" : ""}`}>{children(setPending)}</div>
      )}
    </li>
  );
};

// "Ahora" moves what is already in the mailbox; "A futuro" only changes what arrives from now on.
const When = ({ label, children }: { label: string; children: ReactNode }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5 max-sm:gap-2">
    <span className="w-16 text-meta text-muted">{label}</span>
    {children}
  </span>
);

const SenderRow = ({
  sender,
  report,
  apply,
  shown,
  onToggle,
}: {
  sender: SweepSender;
  report: SweepReport;
  apply: Apply;
  shown: boolean;
  onToggle: () => void;
}) => {
  const [note, setNote] = useState<string | undefined>();
  const tabs = sender.categories.map((c) => TAB[c]).join(" y ");
  return (
    <Row
      id={sender.id}
      stacked
      shown={shown}
      onToggle={onToggle}
      apply={apply}
      title={`${sender.name} · ${count(sender.count)}`}
      detail={`${sender.address} · ${tabs}${sender.filtered ? " · ya filtrado" : ""}`}
      note={note}
    >
      {(ask) => {
        const canFilter = !sender.filtered && report.filters === "ok";
        return (
          <>
            <When label="Ahora">
              <Button
                disabled={apply.isPending}
                onClick={() => {
                  setNote(`Solo lo de ${tabs}; los destacados se quedan.`);
                  ask({ request: { id: sender.id, action: "trash" }, label: `Sí, ${count(sender.count)} a la papelera` });
                }}
              >
                A la papelera ({count(sender.count)})
              </Button>
              <Button
                disabled={apply.isPending}
                onClick={() => {
                  setNote(`Saca del inbox lo de ${tabs}; sigue en Gmail y los destacados se quedan.`);
                  ask({ request: { id: sender.id, action: "archive" }, label: "Sí, archivar" });
                }}
              >
                Archivar
              </Button>
            </When>
            {(sender.canUnsubscribe || canFilter) && (
              <When label="A futuro">
                {sender.canUnsubscribe && (
                  <Button
                    disabled={apply.isPending}
                    onClick={() => {
                      setNote("Jarvis le avisa al remitente que no quieres más correos.");
                      ask({ request: { id: sender.id, action: "unsubscribe" }, label: "Sí, darme de baja" });
                    }}
                  >
                    Darme de baja
                  </Button>
                )}
                {canFilter && (
                  <>
                    <Button
                      disabled={apply.isPending}
                      onClick={() => {
                        setNote("Solo lo que llegue desde ahora, de todo este remitente, también lo que iría a Principal.");
                        ask({
                          request: { id: sender.id, action: "filter", filterAction: "trash" },
                          label: "Sí, lo nuevo a la papelera",
                        });
                      }}
                    >
                      Lo nuevo a la papelera
                    </Button>
                    <Button
                      disabled={apply.isPending}
                      onClick={() => {
                        setNote("Solo lo que llegue desde ahora: entra archivado, sin pasar por el inbox.");
                        ask({
                          request: { id: sender.id, action: "filter", filterAction: "skip_inbox" },
                          label: "Sí, lo nuevo archivado",
                        });
                      }}
                    >
                      Lo nuevo archivado
                    </Button>
                  </>
                )}
              </When>
            )}
          </>
        );
      }}
    </Row>
  );
};

// Finds who fills Promociones and Notificaciones; every action asks first and ends in Gmail's trash, never a delete.
export const MailSweepCard = () => {
  const { data: report } = useMailSweep();
  const analyze = useAnalyzeMailSweep();
  const apply = useApplyMailSweep();
  const remote = useIsRemote();
  // Folded until asked for: cleaning up is for later, after the people who wrote.
  const [open, setOpen] = useState(false);
  const [shownSender, setShownSender] = useState<string | null>(null);

  const analyzeButton = (label: string) => (
    <MutationButton mutation={analyze} disabled={apply.isPending} variant={report ? undefined : "primary"} onClick={() => analyze.mutate(undefined)}>
      {analyze.isPending ? "Analizando… (tarda un par de minutos)" : label}
    </MutationButton>
  );

  if (!report) {
    return (
      <section className="grid gap-3 rounded-lg border border-line bg-surface p-4">
        <Heading className="">Limpiar Gmail</Heading>
        <p className="text-body text-muted">Busca quién te llena Promociones y Notificaciones, y lo viejo que ya no sirve.</p>
        <div>{analyzeButton("Analizar")}</div>
      </section>
    );
  }

  const old = report.ages.reduce((n, age) => n + age.count, 0);
  const summary = [
    `Analizado a las ${timeOf(report.analyzedAt)}`,
    `${count(report.senders.length)} ${report.senders.length === 1 ? "remitente" : "remitentes"}`,
    ...(old > 0 ? [`${count(old)} ${old === 1 ? "correo viejo" : "correos viejos"}`] : []),
  ].join(" · ");

  return (
    <section className="grid gap-4 rounded-lg border border-line bg-surface p-4">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-start gap-2 text-left ${touchTarget}`}
        >
          <span className="flex h-[1lh] items-center text-body">
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.25} aria-hidden />
          </span>
          <span className="grid">
            <span className="text-body font-semibold">Limpiar Gmail</span>
            <span className="text-meta font-normal text-muted">{summary}</span>
          </span>
        </button>
      </h2>
      {open && (
        <>
          <div>{analyzeButton("Volver a analizar")}</div>
          {report.outcome && <p className="rounded-md bg-accent/10 px-3 py-2 text-body">{outcomeText(report.outcome)}</p>}
          {report.filters === "reconnect" && (
            <p className="text-meta text-muted">
              Para crear filtros, Jarvis necesita un permiso más.{" "}
              {remote ? (
                "Reconecta tu Gmail desde la Mac."
              ) : (
                <a className="text-accent underline" href="/api/google/connect?kind=personal">
                  Reconectar Gmail
                </a>
              )}
            </p>
          )}
          {report.ages.length > 0 && (
            <div>
              <h3 className="text-body font-semibold">Lo viejo</h3>
              <ul className="divide-y divide-line">
                {report.ages.map((age) => (
                  <Row
                    key={age.id}
                    id={age.id}
                    apply={apply}
                    title={`${TAB[age.category]} de hace más de ${age.olderThanDays} días · ${count(age.count)}`}
                    detail="Los destacados se quedan."
                  >
                    {(ask) => (
                      <Button
                        disabled={apply.isPending}
                        onClick={() => ask({ request: { id: age.id, action: "trash" }, label: `Sí, ${count(age.count)} a la papelera` })}
                      >
                        A la papelera ({count(age.count)})
                      </Button>
                    )}
                  </Row>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="text-body font-semibold">Quién más te escribe</h3>
            {report.senders.length === 0 ? (
              <p className="py-2 text-meta text-muted">Nadie: Promociones y Notificaciones están vacías.</p>
            ) : (
              <ul className="divide-y divide-line">
                {report.senders.map((s) => (
                  <SenderRow
                    key={s.id}
                    sender={s}
                    report={report}
                    apply={apply}
                    shown={shownSender === s.id}
                    onToggle={() => setShownSender((id) => (id === s.id ? null : s.id))}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
};
