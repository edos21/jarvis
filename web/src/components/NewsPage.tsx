import { useState } from "react";

import type { NewsTopic } from "../../../shared/news";
import { useNews, useNewsRefresh } from "@/lib/api";
import { dateTimeOf } from "@/lib/format";
import { LinkButton, MutationButton } from "./Button";
import { InvestigateButton } from "./InvestigateButton";

const TOPICS: { id: NewsTopic; label: string }[] = [
  { id: "tech", label: "Tecnología" },
  { id: "markets", label: "Mercados" },
  { id: "uruguay", label: "Uruguay" },
  { id: "venezuela", label: "Venezuela" },
];

export const NewsPage = () => {
  const [topic, setTopic] = useState<NewsTopic>("tech");
  const { data, error, isLoading } = useNews(topic);
  const refresh = useNewsRefresh();
  return (
    <main className="mx-auto grid max-w-3xl content-start gap-4 px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[28px] leading-tight">Noticias</h1>
          <p className="text-meta text-muted">
            De tus fuentes en <code>~/.jarvis/news-feeds</code>
            {data?.fetchedAt && ` · leídas a las ${new Date(data.fetchedAt).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
        </div>
        <MutationButton mutation={refresh} onClick={() => refresh.mutate()}>
          Actualizar
        </MutationButton>
      </header>
      <div role="tablist" aria-label="Temas" className="flex flex-wrap gap-1.5 max-sm:gap-2">
        {TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={topic === t.id}
            onClick={() => setTopic(t.id)}
            className={`rounded-full border px-3 py-1 text-body max-sm:min-h-11 ${topic === t.id ? "border-accent bg-accent text-accent-ink" : "border-control bg-surface hover:border-accent"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isLoading && <p className="text-muted">Leyendo titulares…</p>}
      {error && <p className="text-critical">No pude leer las noticias: {error.message}</p>}
      {data && data.errors.length > 0 && <p className="text-meta text-muted">No respondieron: {data.errors.join(", ")}.</p>}
      {data && data.items.length === 0 && <p className="text-muted">Nada nuevo en las últimas 48 horas.</p>}
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {data?.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <div className="min-w-0 flex-1 basis-64">
              <a href={item.url} target="_blank" rel="noreferrer" className="text-body font-medium hover:text-accent max-sm:flex max-sm:min-h-11 max-sm:items-center">
                {item.title}
              </a>
              <p className="text-meta text-muted">
                {item.ticker ? <b className="text-ink">{item.ticker}</b> : item.source} · {dateTimeOf(item.publishedAt)}
              </p>
            </div>
            <div className="flex gap-1.5 max-sm:gap-2">
              <LinkButton href={item.url}>Abrir</LinkButton>
              <InvestigateButton subject={{ type: "news", title: item.title, url: item.url }} />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
};
