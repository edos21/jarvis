import type { AgendaResponse } from "../../../shared/calendar";
import type { MacStatus } from "../../../shared/mac";
import type { TodayCard } from "../../../shared/today";
import type { WalletResponse } from "../../../shared/wallet";
import type { WorkSummary } from "../../../shared/work";
import { useIsRemote } from "@/lib/api";
import { AgendaBlock } from "./AgendaBlock";
import { Heading } from "./Heading";
import { PushToggle } from "./PushToggle";
import { StatusText } from "./Status";
import { WalletBlock } from "./WalletBlock";

const Row = ({ n, children, tone }: { n: React.ReactNode; children: React.ReactNode; tone?: string }) => (
  <div className="grid grid-cols-[2.5rem_1fr] py-1 text-body">
    <span className={`font-mono font-medium [font-variant-numeric:tabular-nums] ${tone ?? "text-muted"}`}>{n}</span>
    <span>{children}</span>
  </div>
);

const Meter = ({ label, pct, warnAt }: { label: string; pct: number; warnAt: number }) => (
  <div className="grid grid-cols-[4.5rem_1fr_2.75rem] items-center gap-x-2 gap-y-0.5 py-1 text-body [font-variant-numeric:tabular-nums]">
    <span>{label}</span>
    <span className="h-1.5 overflow-hidden rounded bg-line" aria-hidden>
      <span
        className={`block h-full ${pct >= warnAt ? "bg-warning" : "bg-control"}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </span>
    <span className="text-right font-mono font-medium">{Math.round(pct)}%</span>
    {pct >= warnAt && (
      <StatusText severity="warning" className="col-span-2 col-start-2 text-meta">
        Alto
      </StatusText>
    )}
  </div>
);

export const WorkBlock = ({ work }: { work: WorkSummary | null }) => {
  // Pepper lives on the Mac only: from the phone its link would go nowhere.
  const remote = useIsRemote();
  if (!work) return <p className="text-meta text-muted">No se pudo leer el trabajo.</p>;
  const { pepper, prs } = work;
  const failing = prs?.filter((p) => p.ci === "failing").length ?? 0;
  return (
    <div>
      {pepper.reachable ? (
        <>
          <Row n={pepper.decisions}>
            {remote ? (
              "decisiones en Pepper"
            ) : (
              <a className="hover:text-accent" href={pepper.boardUrl} target="_blank" rel="noreferrer">
                decisiones en Pepper
              </a>
            )}
          </Row>
          <Row n={pepper.factoryWaiting.length} tone={pepper.factoryWaiting.length > 0 ? "text-warning" : undefined}>
            {pepper.factoryWaiting.length > 0 ? (
              <StatusText severity="warning">esperándote en las fábricas</StatusText>
            ) : (
              "esperándote en las fábricas"
            )}
          </Row>
          <Row n={pepper.factoryInProgress}>en curso en las fábricas</Row>
          <Row n={pepper.toVerify.length}>en producción, por verificar</Row>
        </>
      ) : (
        <p className="py-1 text-body">
          <StatusText severity="warning">Pepper no responde.</StatusText>
        </p>
      )}
      {prs === null ? (
        <p className="py-1 text-meta text-muted">No se pudieron leer los PRs.</p>
      ) : (
        <Row n={prs.length}>
          PRs abiertos
          {failing > 0 && (
            <>
              {" · "}
              <StatusText severity="critical">{failing} con CI en rojo</StatusText>
            </>
          )}
        </Row>
      )}
    </div>
  );
};

export const MacBlock = ({ mac }: { mac: MacStatus | null }) => {
  if (!mac) return <p className="text-meta text-muted">No se pudo leer el estado de la Mac.</p>;
  return (
    <div>
      <Meter label="CPU" pct={mac.cpuPct} warnAt={85} />
      <Meter label="Memoria" pct={mac.memPct} warnAt={90} />
      <Meter label="Disco" pct={mac.diskPct} warnAt={85} />
      <p className="mt-2 text-meta text-muted">
        {mac.uptimeDays} {mac.uptimeDays === 1 ? "día" : "días"} sin reiniciar
        {mac.updates && mac.updates.length > 0 && ` · ${mac.updates.length} updates`}
      </p>
    </div>
  );
};

// What already has a card on Today, so the side column doesn't say it a second time.
const shownAsCards = (cards: TodayCard[]) => ({
  taskIds: new Set(cards.flatMap((c) => c.actions).flatMap((a) => (a.kind === "complete_task" ? [a.taskId] : []))),
  symbols: cards
    .filter((c) => c.source === "wallet")
    .flatMap((c) => c.actions)
    .flatMap((a) => (a.kind === "investigate" && a.subject.type === "ticker" ? [a.subject.symbol] : [])),
  mac: cards.some((c) => c.source === "mac"),
});

export const SideColumn = ({
  agenda,
  wallet,
  work,
  mac,
  cards,
}: {
  agenda: AgendaResponse | null;
  wallet: WalletResponse | null;
  work: WorkSummary | null;
  mac: MacStatus | null;
  cards: TodayCard[];
}) => {
  const shown = shownAsCards(cards);
  return (
    <aside className="grid content-start gap-6 border-line px-5 py-6 lg:border-l">
      <section>
        <Heading>Agenda</Heading>
        <AgendaBlock agenda={agenda} hideTasks={shown.taskIds} />
      </section>
      <section>
        <Heading>Cartera</Heading>
        <WalletBlock wallet={wallet} hideSymbols={shown.symbols} />
      </section>
      <section>
        <Heading>Trabajo</Heading>
        <WorkBlock work={work} />
      </section>
      {/* A Mac alert is already a card; on the phone the Mac has its own section. */}
      {!shown.mac && (
        <section className="max-sm:hidden">
          <Heading>Mac</Heading>
          <MacBlock mac={mac} />
        </section>
      )}
      <section>
        <Heading>Avisos</Heading>
        <PushToggle />
      </section>
    </aside>
  );
};
