import { CircleCheck, Clock, OctagonAlert } from "lucide-react";
import type { ResearchDetail, ResearchRun } from "../../../shared/research";
import { type SuggestedLevel, type WalletPosition, type WalletResponse, sameTicker } from "../../../shared/wallet";
import { useAddLevel, useIsRemote, useResearch, useResearchList, useSaveResearch, useWallet } from "@/lib/api";
import { LEVEL_DIRECTION_LABEL, LEVEL_KIND_LABEL, amountIn, dateTimeOf, ticker } from "@/lib/format";
import { go, routeHref, useRouteParam } from "@/lib/route";
import { MutationButton } from "./Button";
import { Markdown } from "./Markdown";
import { IconText } from "./Status";

const STATUS = { running: "Investigando…", done: "Listo", failed: "Falló" } as const;
const STATUS_TONE = { running: "text-warning", done: "text-good", failed: "text-critical" } as const;
const STATUS_ICON = { running: Clock, done: CircleCheck, failed: OctagonAlert } as const;

const RunRow = ({ run, active }: { run: ResearchRun; active: boolean }) => (
  <li>
    <button
      type="button"
      onClick={() => go("analisis", run.id)}
      aria-current={active ? "true" : undefined}
      className={`grid w-full gap-0.5 rounded-md px-3 py-2 text-left ${active ? "bg-highlight" : "hover:bg-surface"}`}
    >
      <span className="truncate text-body font-medium">{run.title}</span>
      <span className="text-meta text-muted">
        <IconText Icon={STATUS_ICON[run.status]} tone={STATUS_TONE[run.status]}>
          {STATUS[run.status]}
        </IconText>{" "}
        · {dateTimeOf(run.createdAt)}
        {run.savedPath && " · guardado"}
      </span>
    </button>
  </li>
);

// Each suggestion becomes a level only with my click, and only for a ticker I hold: the others would never be checked.
const SuggestionAction = ({ suggestion, position, wallet, researchId }: {
  suggestion: SuggestedLevel;
  position: WalletPosition | undefined;
  wallet: WalletResponse | undefined;
  researchId: number;
}) => {
  const add = useAddLevel();
  const remote = useIsRemote();
  // Until the wallet answers, "not in your portfolio" would be a guess.
  if (!wallet?.view) return null;
  if (!position) return <span className="text-meta text-muted">No está en tu cartera</span>;
  const existing = wallet?.levels.some(
    (l) =>
      sameTicker(l.symbol, suggestion.symbol) &&
      l.kind === suggestion.kind &&
      l.direction === suggestion.direction &&
      l.price === suggestion.price,
  );
  if (existing) return <span className="text-meta text-good">Ya lo tienes</span>;
  if (remote) return null;
  const { why, ...level } = suggestion;
  return (
    <MutationButton mutation={add} onClick={() => add.mutate({ ...level, symbol: position.symbol, note: why || null, researchId })}>
      Crear nivel
    </MutationButton>
  );
};

const SuggestedLevels = ({ detail }: { detail: ResearchDetail }) => {
  const { data: wallet } = useWallet();
  return (
    <section className="grid gap-2 rounded-lg border border-line px-4 py-3">
      <h3 className="text-body font-medium">Niveles sugeridos</h3>
      <ul className="grid gap-2 text-body">
        {detail.suggestedLevels.map((s, i) => {
          const position = wallet?.view?.positions.find((p) => sameTicker(p.symbol, s.symbol));
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 flex-1">
                <span className="text-muted">{LEVEL_KIND_LABEL[s.kind]}:</span> <b>{ticker(s.symbol)}</b>{" "}
                {LEVEL_DIRECTION_LABEL[s.direction]} <b>{amountIn(s.price, position?.currency ?? "USD")}</b>
                {s.why && <span className="text-muted"> · {s.why}</span>}
              </span>
              <SuggestionAction suggestion={s} position={position} wallet={wallet} researchId={detail.id} />
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const Detail = ({ id }: { id: number }) => {
  const { data: detail, error } = useResearch(id);
  const save = useSaveResearch();
  const remote = useIsRemote();
  if (error) return <p className="text-critical">No pude abrir el análisis: {error.message}</p>;
  if (!detail) return <p className="text-muted">Abriendo…</p>;
  return (
    <article className="grid content-start gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[24px] leading-tight">{detail.title}</h2>
          <p className="text-meta text-muted">
            {dateTimeOf(detail.createdAt)}
            {detail.costUsd !== null && ` · ${amountIn(detail.costUsd, "USD")}`}
            {detail.savedPath &&
              (remote ? (
                ` · guardado en ${detail.savedPath}`
              ) : (
                <>
                  {" · guardado en "}
                  <a className="underline" href={routeHref("notas", detail.savedPath)}>
                    {detail.savedPath}
                  </a>
                </>
              ))}
          </p>
        </div>
        {detail.status === "done" && !remote && (
          <MutationButton mutation={save} variant={detail.savedPath ? "plain" : "primary"} onClick={() => save.mutate(detail.id)}>
            {detail.savedPath ? "Guardar otra copia" : "Guardar en notas"}
          </MutationButton>
        )}
      </header>
      {detail.status === "running" && (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-muted">
          Claude está investigando en la web. Puede tardar unos minutos; esta página se actualiza sola.
        </p>
      )}
      {detail.status === "failed" && <p className="text-critical">No terminó: {detail.error}</p>}
      {detail.jarvisNote && (
        <aside className="grid gap-1 border-l-2 border-line pl-4">
          <p className="text-meta text-muted">Nota de Jarvis</p>
          <p className="font-serif text-[18px] leading-normal italic text-pretty">{detail.jarvisNote}</p>
        </aside>
      )}
      {detail.suggestedLevels.length > 0 && <SuggestedLevels detail={detail} />}
      {detail.markdown && <Markdown>{detail.markdown}</Markdown>}
    </article>
  );
};

export const ResearchPage = () => {
  const param = useRouteParam();
  const { data, error } = useResearchList();
  const runs = data?.runs ?? [];
  const selected = param ? Number(param) : (runs[0]?.id ?? null);
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[18rem_1fr]">
      <section className="grid content-start gap-2">
        <h1 className="font-serif text-[28px] leading-tight">Análisis</h1>
        {error && <p className="text-critical">{error.message}</p>}
        {runs.length === 0 ? (
          <p className="text-body text-muted">
            Todavía no hay análisis. Usa "Investigar" en Cartera o en Noticias, o el satellite pick del mes.
          </p>
        ) : (
          <ul className="grid gap-0.5">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} active={run.id === selected} />
            ))}
          </ul>
        )}
      </section>
      <section className="min-w-0">{selected !== null && <Detail id={selected} />}</section>
    </main>
  );
};
