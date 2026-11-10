import { ChevronDown, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type { AgendaResponse } from "../../../shared/calendar";
import type { Severity } from "../../../shared/mac";
import type { TodayCard as Card } from "../../../shared/today";
import { useMarkBriefingSeen, useToday } from "@/lib/api";
import { timeOf } from "@/lib/format";
import { touchTarget } from "./Button";
import { BriefingVoice } from "./BriefingVoice";
import { SideColumn } from "./SideColumn";
import { IconText, StatusText } from "./Status";
import { TodayCard } from "./TodayCard";

const SOURCE_LABEL = {
  payments: "los pagos",
  agenda: "la agenda",
  mail: "el correo",
  wallet: "la cartera",
  work: "el trabajo",
  mac: "la Mac",
} as const;

const SEVERITY_COUNT: Record<Severity, (n: number) => string> = {
  critical: (n) => `${n} ${n === 1 ? "urgente" : "urgentes"}`,
  warning: (n) => `${n} de atención`,
  info: (n) => `${n} ${n === 1 ? "aviso" : "avisos"}`,
};
const SEVERITIES: Severity[] = ["critical", "warning", "info"];

type BriefingProps = { text: string | null; status: string; voice: boolean };

const BriefingBlock = ({ text, status, voice, autoplay }: BriefingProps & { autoplay: boolean }) => {
  if (text) {
    return (
      <>
        <p className="max-w-[34em] font-serif text-[22px] leading-[1.42] text-pretty sm:text-[24px]">{text}</p>
        {status === "pending" && (
          <p role="status" className="text-meta text-muted">
            Actualizando el resumen…
          </p>
        )}
        {/* Any text shown is one Jarvis wrote, so it can be heard; staying mounted while the next one is written
            keeps the reading from being cut off mid-sentence. */}
        {voice && <BriefingVoice text={text} autoplay={autoplay} />}
      </>
    );
  }
  if (status === "pending") {
    return <p className="font-serif text-[22px] text-muted">Leyendo tu día…</p>;
  }
  return null;
};

// Read once, the briefing steps aside: one tap away instead of pushing what needs me down the screen.
const FoldedBriefing = (props: BriefingProps) => {
  const [open, setOpen] = useState(false);
  if (!props.text && props.status !== "pending") return null;
  return (
    <div className="grid gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 justify-self-start rounded-md text-body font-medium text-accent hover:underline ${touchTarget}`}
      >
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.25} aria-hidden />
        {open ? "Ocultar el parte de hoy" : "Leer el parte de hoy"}
      </button>
      {open && <BriefingBlock {...props} autoplay={false} />}
    </div>
  );
};

// The first line a glance needs: does anything need me, and how badly.
const Waiting = ({ cards }: { cards: Card[] }) => (
  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
    <p className="text-title font-semibold">{cards.length === 1 ? "Te espera 1" : `Te esperan ${cards.length}`}</p>
    {SEVERITIES.map((severity) => {
      const n = cards.filter((c) => c.severity === severity).length;
      return n > 0 ? (
        <StatusText key={severity} severity={severity} className="text-body">
          {SEVERITY_COUNT[severity](n)}
        </StatusText>
      ) : null;
    })}
  </div>
);

const nextEvent = (agenda: AgendaResponse | null, now: Date) =>
  agenda?.items.find((item) => !item.allDay && new Date(item.start) > now) ?? null;

const AllClear = ({ agenda, partial }: { agenda: AgendaResponse | null; partial: boolean }) => {
  const next = nextEvent(agenda, new Date());
  return (
    <section className="grid gap-1 rounded-lg border border-line bg-surface px-4 py-4">
      <IconText Icon={CircleCheck} tone="text-good" className="text-title font-semibold">
        Al día
      </IconText>
      <p className="text-body">{partial ? "Nada te espera en lo que pude leer." : "Nada te espera ahora."}</p>
      {next && (
        <p className="text-body text-muted [font-variant-numeric:tabular-nums]">
          Lo próximo: {timeOf(next.start)} {next.title}
        </p>
      )}
    </section>
  );
};

export const TodayPage = () => {
  const { data, error, isLoading } = useToday();
  const { mutate: markSeen } = useMarkBriefingSeen();
  // Open while I read it: marking it seen folds it on the next glance, not under my eyes.
  const [reading, setReading] = useState(false);
  const unread = data?.briefingSeen === false;
  const hasText = Boolean(data?.briefing);

  useEffect(() => {
    if (!unread || !hasText) return;
    setReading(true);
    markSeen();
  }, [unread, hasText, markSeen]);

  useEffect(() => {
    // An installed app stays alive in the background: coming back to it later is a new glance.
    const onHide = () => document.visibilityState === "hidden" && setReading(false);
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  if (isLoading) return <p className="p-8 text-muted">Cargando…</p>;
  if (error || !data) {
    return <p className="p-8 text-critical">No pude cargar el día: {error?.message ?? "sin respuesta"}</p>;
  }
  const briefing = { text: data.briefing, status: data.briefingStatus, voice: data.briefingVoice };
  const next = nextEvent(data.side.agenda, new Date());
  return (
    <div className="mx-auto grid min-h-full max-w-[1180px] lg:grid-cols-[minmax(0,1fr)_320px]">
      <main className="grid w-full max-w-3xl content-start gap-5 px-5 py-6 sm:px-8 sm:py-8">
        <header className="grid gap-2">
          <p className="text-meta text-muted first-letter:uppercase">
            {data.dateLabel} · {timeOf(data.generatedAt)}
          </p>
          <h1 className="font-serif text-[28px] leading-tight sm:text-[32px]">{data.greeting}</h1>
          {unread || reading ? <BriefingBlock {...briefing} autoplay /> : <FoldedBriefing {...briefing} />}
        </header>
        {data.sourceErrors.length > 0 && (
          <p className="text-body">
            <StatusText severity="warning">
              No pude leer {data.sourceErrors.map((s) => SOURCE_LABEL[s]).join(" ni ")}; el resto está al día.
            </StatusText>
          </p>
        )}
        {data.cards.length > 0 ? (
          <div className="grid gap-2.5">
            <Waiting cards={data.cards} />
            {/* On the phone the agenda sits below every card: what comes next goes up here. */}
            {next && (
              <p className="text-body [font-variant-numeric:tabular-nums] sm:hidden">
                Lo próximo: {timeOf(next.start)} {next.title}
              </p>
            )}
            {data.cards.map((card) => (
              <TodayCard key={card.key} card={card} />
            ))}
          </div>
        ) : (
          <AllClear agenda={data.side.agenda} partial={data.sourceErrors.length > 0} />
        )}
      </main>
      <SideColumn
        agenda={data.side.agenda}
        wallet={data.side.wallet}
        work={data.side.work}
        mac={data.side.mac}
        cards={data.cards}
      />
    </div>
  );
};
