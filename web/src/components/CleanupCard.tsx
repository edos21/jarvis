import { useState } from "react";

import type { CleanupAction, CleanupArea, CleanupFinding } from "../../../shared/mac";
import { useAnalyzeCleanup, useApplyCleanup, useCleanup } from "@/lib/api";
import { formatBytes, timeOf } from "@/lib/format";
import { Button, MutationButton } from "./Button";
import { Heading } from "./Heading";
import { StatusText } from "./Status";

const AREAS: { area: CleanupArea; label: string }[] = [
  { area: "disk", label: "Disco" },
  { area: "memory", label: "Memoria" },
  { area: "cpu", label: "CPU" },
];

const ACTION_LABEL: Record<CleanupAction["kind"], string> = {
  docker_prune: "Limpiar",
  docker_volume: "Borrar",
  cache: "Limpiar",
  quit_app: "Cerrar app",
  compose_stop: "Detener",
};

const total = (findings: CleanupFinding[]): number => findings.reduce((n, f) => n + (f.bytes ?? 0), 0);

type Apply = ReturnType<typeof useApplyCleanup>;

const FindingRow = ({ finding, apply }: { finding: CleanupFinding; apply: Apply }) => {
  const [confirming, setConfirming] = useState(false);
  const { action } = finding;
  const mine = apply.variables === finding.id;
  const label = action ? ACTION_LABEL[action.kind] : null;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-body font-medium">
          {finding.title}
          {finding.bytes !== null && finding.area !== "cpu" && (
            <span className="ml-2 font-normal text-muted [font-variant-numeric:tabular-nums]">{formatBytes(finding.bytes)}</span>
          )}
        </p>
        {finding.risk === "data" ? (
          <p className="text-meta">
            <StatusText severity="critical">{finding.detail}</StatusText>
          </p>
        ) : (
          <p className="text-meta text-muted">{finding.detail}</p>
        )}
        {mine && apply.error && <p className="text-meta text-critical">{apply.error.message}</p>}
      </div>
      {label &&
        (confirming ? (
          <span className="inline-flex items-center gap-1.5 max-sm:gap-2">
            <Button
              variant="danger"
              disabled={apply.isPending}
              onClick={() => apply.mutate(finding.id, { onSettled: () => setConfirming(false) })}
            >
              {mine && apply.isPending ? "Trabajando…" : finding.risk === "data" ? "Borrar para siempre" : `Sí, ${label.toLowerCase()}`}
            </Button>
            <Button disabled={apply.isPending} onClick={() => setConfirming(false)}>
              No
            </Button>
          </span>
        ) : (
          <Button disabled={apply.isPending} onClick={() => setConfirming(true)}>
            {label}
          </Button>
        ))}
    </li>
  );
};

const FindingList = ({ findings, apply }: { findings: CleanupFinding[]; apply: Apply }) => (
  <ul className="divide-y divide-line">
    {findings.map((f) => (
      <FindingRow key={f.id} finding={f} apply={apply} />
    ))}
  </ul>
);

// Analyzes on a click, never on its own: Docker and du take seconds. Each fix asks first, and the server re-checks
// that nothing started running in between.
export const CleanupCard = () => {
  const { data: report } = useCleanup();
  const analyze = useAnalyzeCleanup();
  const apply = useApplyCleanup();

  if (!report) {
    return (
      <section className="grid gap-3 rounded-lg border border-line bg-surface p-4">
        <Heading className="">Liberar espacio y memoria</Heading>
        <p className="text-body text-muted">Revisa Docker, las cachés de desarrollo y las apps que más consumen.</p>
        <div>
          <MutationButton variant="primary" mutation={analyze} onClick={() => analyze.mutate(undefined)}>
            {analyze.isPending ? "Analizando…" : "Analizar"}
          </MutationButton>
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading className="">Liberar espacio y memoria</Heading>
        <span className="inline-flex items-center gap-2 text-meta text-muted">
          Analizado a las {timeOf(report.analyzedAt)}
          <MutationButton mutation={analyze} disabled={apply.isPending} onClick={() => analyze.mutate(undefined)}>
            {analyze.isPending ? "Analizando…" : "Volver a analizar"}
          </MutationButton>
        </span>
      </div>
      {report.freedBytes !== null && (
        <p className="rounded-md bg-accent/10 px-3 py-2 text-body">
          {report.freedBytes >= 1e6
            ? `Liberaste ${formatBytes(report.freedBytes)} en disco.`
            : "Listo. macOS todavía no muestra el espacio libre: puede tardar unos minutos en aparecer."}
        </p>
      )}
      {!report.docker.available && <p className="text-meta text-muted">Docker no está corriendo, así que no lo revisé.</p>}
      {AREAS.map(({ area, label }) => {
        const findings = report.findings.filter((f) => f.area === area);
        const volumes = findings.filter((f) => f.action?.kind === "docker_volume");
        const rest = findings.filter((f) => f.action?.kind !== "docker_volume");
        return (
          <div key={area}>
            <h3 className="text-body font-semibold">{label}</h3>
            {findings.length === 0 ? (
              <p className="py-2 text-meta text-muted">Nada que hacer aquí.</p>
            ) : (
              <>
                <FindingList findings={rest} apply={apply} />
                {volumes.length > 0 && (
                  <details className="border-t border-line pt-2">
                    <summary className="cursor-pointer text-body font-medium">
                      {volumes.length === 1 ? "1 volumen sin usar" : `${volumes.length} volúmenes sin usar`}
                      <span className="ml-2 font-normal text-muted">{formatBytes(total(volumes))}</span>
                    </summary>
                    <p className="mt-1 text-body text-muted">
                      Son datos de proyectos de Docker que ya no corren. Se borran de a uno, y no vuelven.
                    </p>
                    <FindingList findings={volumes} apply={apply} />
                  </details>
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
};
