import { CircleCheck } from "lucide-react";
import { useIsRemote, useMac } from "@/lib/api";
import { timeOf } from "@/lib/format";
import { ClaudeSessionsCard } from "./ClaudeSessionsCard";
import { CleanupCard } from "./CleanupCard";
import { MacHistoryChart } from "./MacHistoryChart";
import { MoleCard } from "./MoleCard";
import { MacBlock } from "./SideColumn";
import { IconText } from "./Status";
import { TodayCard } from "./TodayCard";

export const MacPage = () => {
  const { data, error, isLoading } = useMac();
  const remote = useIsRemote();
  if (isLoading) return <p className="p-8 text-muted">Leyendo la Mac…</p>;
  if (error || !data) return <p className="p-8 text-critical">No pude leer la Mac: {error?.message}</p>;
  const { status, suggestions } = data;
  return (
    <main className="mx-auto grid max-w-3xl content-start gap-6 px-5 py-6 sm:px-8 sm:py-8">
      <header>
        <h1 className="font-serif text-[28px] leading-tight">Mac</h1>
        <p className="text-body text-muted">Leída a las {timeOf(status.collectedAt)}, se actualiza cada minuto.</p>
      </header>
      <section className="rounded-lg border border-line bg-surface p-4">
        <MacBlock mac={status} />
        <p className="mt-1 text-meta text-muted">{status.diskFreeGb} GB libres en disco.</p>
      </section>
      <MacHistoryChart />
      <section className="grid gap-2.5">
        {suggestions.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-body">
            <IconText Icon={CircleCheck} tone="text-good">
              Todo en orden.
            </IconText>
          </p>
        ) : (
          suggestions.map((s) => (
            <TodayCard
              key={s.key}
              card={{
                key: s.key,
                severity: s.severity,
                source: "mac",
                title: s.title,
                detail: s.detail,
                actions: s.cta && !remote
                  ? [{ kind: "mac_cta", label: s.cta.kind === "kill" ? "Cerrar proceso" : "Abrir", cta: s.cta }]
                  : [],
              }}
            />
          ))
        )}
      </section>
      {!remote && <CleanupCard />}
      {!remote && <MoleCard />}
      {!remote && <ClaudeSessionsCard />}
      {status.updates && status.updates.length > 0 && (
        <section>
          <h2 className="mb-2 text-body font-semibold">Actualizaciones</h2>
          <ul className="grid gap-1 text-body">
            {status.updates.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
};
