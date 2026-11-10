import { type ComponentProps, useState } from "react";

import { type CleanRowKind, type DiskView, MOLE_PREVIEW_TTL_MINUTES, type MoleReport, type MoleRun } from "../../../shared/mac";
import { useMole, useMoleAnalyze, useMoleApply, useMolePreview } from "@/lib/api";
import { formatBytes, timeOf } from "@/lib/format";
import { Button, MutationButton } from "./Button";
import { Heading } from "./Heading";

const ROW_ICON: Record<CleanRowKind, { icon: string; className: string; label: string }> = {
  clean: { icon: "○", className: "text-ink", label: "Se borra" },
  review: { icon: "⊙", className: "text-muted", label: "Solo lo señala, no lo borra" },
  skipped: { icon: "◎", className: "text-muted", label: "Lo deja afuera" },
};

const until = (previewedAt: string): string => timeOf(Date.parse(previewedAt) + MOLE_PREVIEW_TTL_MINUTES * 60_000);

const size = (bytes: number | null): string | null => (bytes === null ? null : formatBytes(bytes));

// The button a deletion starts from, and the second click that confirms it.
const ConfirmButton = ({
  label,
  confirmLabel,
  mutation,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  mutation: { isPending: boolean; error: Error | null };
  disabled?: boolean;
  onConfirm: (done: () => void) => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 max-sm:gap-2">
      {confirming ? (
        <>
          <Button variant="danger" disabled={disabled || mutation.isPending} onClick={() => onConfirm(() => setConfirming(false))}>
            {mutation.isPending ? "Trabajando…" : confirmLabel}
          </Button>
          <Button disabled={mutation.isPending} onClick={() => setConfirming(false)}>
            No
          </Button>
        </>
      ) : (
        <Button disabled={disabled || mutation.isPending} onClick={() => setConfirming(true)}>
          {label}
        </Button>
      )}
      {mutation.error && <span className="text-meta text-critical">{mutation.error.message}</span>}
    </span>
  );
};

// A block's title and the one button that runs it (each run takes from seconds to minutes).
const BlockHeader = ({ title, ...button }: { title: string } & ComponentProps<typeof MutationButton>) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="text-body font-semibold">{title}</h3>
    <MutationButton {...button} />
  </div>
);

const LastRun = ({ run }: { run: MoleRun }) => {
  const removed = size(run.removedBytes);
  if (run.kind === "installers") {
    return (
      <p className="rounded-md bg-accent/10 px-3 py-2 text-body">
        Moviste {removed ?? "0 MB"} de instaladores a la Papelera. El espacio vuelve cuando la vacíes.
        {run.skipped.length > 0 && ` Dejé donde estaban ${run.skipped.join(", ")}: cambiaron después de la búsqueda.`}
      </p>
    );
  }
  const parts = [
    run.estimatedBytes !== null && `Mole estimó ${formatBytes(run.estimatedBytes)}`,
    removed && `borró ${removed}`,
    run.freedBytes !== null && run.freedBytes >= 1e6 && `el disco ganó ${formatBytes(run.freedBytes)}`,
  ].filter(Boolean);
  return (
    <p className="rounded-md bg-accent/10 px-3 py-2 text-body">
      {run.complete
        ? `A las ${timeOf(run.at)} terminó la limpieza.`
        : `Mole cortó la limpieza de las ${timeOf(run.at)} antes de terminar: parte puede haberse borrado.`}{" "}
      {parts.length > 0 ? `${parts.join(", ")}.` : ""}
    </p>
  );
};

const DiskBlock = ({ disk }: { disk: DiskView | null }) => {
  const analyze = useMoleAnalyze();
  const go = (path: string | null) => analyze.mutate(path);
  return (
    <div className="grid gap-2">
      <BlockHeader title="Uso del disco" mutation={analyze} onClick={() => go(null)}>
        {analyze.isPending ? "Analizando…" : disk ? "Volver al resumen" : "Analizar"}
      </BlockHeader>
      {!disk ? (
        <p className="text-body text-muted">Qué ocupa el disco, carpeta por carpeta. Solo mira, no borra nada. Puede tardar un minuto.</p>
      ) : (
        <>
          <p className="text-meta text-muted">
            <button type="button" className="hover:text-ink" disabled={analyze.isPending} onClick={() => go(null)}>
              Mac
            </button>
            {disk.trail.map((t) => (
              <span key={t.path}>
                {" / "}
                <button type="button" className="hover:text-ink" disabled={analyze.isPending} onClick={() => go(t.path)}>
                  {t.name}
                </button>
              </span>
            ))}
            {` · ${formatBytes(disk.totalBytes)} · a las ${timeOf(disk.analyzedAt)}`}
            {disk.scanStatus !== "complete" && " · parcial: hay carpetas que macOS no deja leer"}
          </p>
          <ul className="divide-y divide-line">
            {disk.entries.map((e) => (
              <li key={e.path} className="flex items-center gap-3 py-1.5 text-body">
                {e.isDir ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left hover:text-accent"
                    title={e.path}
                    disabled={analyze.isPending}
                    onClick={() => go(e.path)}
                  >
                    {e.name}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate" title={e.path}>
                    {e.name}
                  </span>
                )}
                {e.cleanable && <span className="text-meta text-good">se puede limpiar</span>}
                <span className="text-muted [font-variant-numeric:tabular-nums]">{formatBytes(e.bytes)}</span>
              </li>
            ))}
          </ul>
          {disk.largeFiles.length > 0 && (
            <details>
              <summary className="cursor-pointer text-body font-medium">Archivos más grandes</summary>
              <ul className="mt-1 grid gap-1 text-body">
                {disk.largeFiles.map((f) => (
                  <li key={f.path} className="flex gap-3">
                    <span className="min-w-0 flex-1 truncate" title={f.path}>
                      {f.path}
                    </span>
                    <span className="text-muted [font-variant-numeric:tabular-nums]">{formatBytes(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
};

const CleanBlock = ({ clean }: { clean: MoleReport["clean"] }) => {
  const preview = useMolePreview("clean");
  const apply = useMoleApply("clean");
  return (
    <div className="grid gap-2">
      <BlockHeader title="Limpieza profunda" mutation={preview} disabled={apply.isPending} onClick={() => preview.mutate(undefined)}>
        {preview.isPending ? "Previsualizando…" : clean ? "Volver a previsualizar" : "Previsualizar"}
      </BlockHeader>
      {!clean ? (
        <p className="text-body text-muted">
          Cachés, logs y restos de apps. Primero muestra qué borraría, sin tocar nada. Solo después puedes limpiar.
        </p>
      ) : (
        <>
          <p className="text-body">
            Mole liberaría <strong>{size(clean.potentialBytes) ?? "un tamaño que no pudo medir"}</strong>
            {clean.items !== null && ` en ${clean.items.toLocaleString("es-UY")} elementos`}.
            <span className="ml-2 text-meta text-muted">Vigente hasta las {until(clean.previewedAt)}.</span>
          </p>
          {clean.skippedSystem && (
            <p className="text-body text-muted">Las cachés del sistema quedan afuera: necesitan sudo y Jarvis nunca lo pide.</p>
          )}
          {clean.emptiesTrash && (
            <p className="text-body text-critical">
              Esta limpieza vaciaría la Papelera. Protégela una vez en la Terminal con mo clean --whitelist, marca Trash y guarda.
              Después vuelve a previsualizar.
            </p>
          )}
          <div className="grid gap-1">
            {clean.sections.map((s) => (
              <details key={s.name} className="border-t border-line pt-1.5">
                <summary className="cursor-pointer text-body font-medium">
                  {s.name}
                  {s.bytes > 0 && <span className="ml-2 font-normal text-muted">{formatBytes(s.bytes)}</span>}
                </summary>
                <ul className="mt-1 grid gap-0.5 text-body">
                  {s.rows.map((r, i) => (
                    <li key={`${i}-${r.text}`} className={ROW_ICON[r.kind].className} title={ROW_ICON[r.kind].label}>
                      {ROW_ICON[r.kind].icon} {r.text}
                    </li>
                  ))}
                </ul>
                {s.topPaths.length > 0 && (
                  <ul className="mt-1 grid gap-0.5 text-meta text-muted">
                    {s.topPaths.map((p) => (
                      <li key={p.path} className="truncate" title={p.path}>
                        {formatBytes(p.bytes)} · {p.path}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            ))}
          </div>
          <p className="text-meta text-muted">○ se borra · ⊙ solo lo señala · ◎ lo deja afuera</p>
          <div>
            {/* Keyed by the preview: a new preview never inherits a confirmation given to the previous one. */}
            <ConfirmButton
              key={clean.id}
              label="Limpiar"
              confirmLabel="Borrar para siempre"
              mutation={apply}
              disabled={clean.emptiesTrash || preview.isPending}
              onConfirm={(done) => apply.mutate(clean.id, { onSettled: done })}
            />
          </div>
        </>
      )}
    </div>
  );
};

const InstallersBlock = ({ installers }: { installers: MoleReport["installers"] }) => {
  const preview = useMolePreview("installers");
  const apply = useMoleApply("installers");
  return (
    <div className="grid gap-2">
      <BlockHeader title="Instaladores viejos" mutation={preview} disabled={apply.isPending} onClick={() => preview.mutate(undefined)}>
        {preview.isPending ? "Buscando…" : installers ? "Volver a buscar" : "Buscar"}
      </BlockHeader>
      {!installers ? (
        <p className="text-body text-muted">DMG, PKG e ISO en Descargas, Escritorio y Documentos. Van a la Papelera, no se borran.</p>
      ) : installers.files.length === 0 ? (
        <p className="text-meta text-muted">No encontré instaladores.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {installers.files.map((f) => (
              <li key={f.path} className="flex items-center gap-3 py-1.5 text-body">
                <span className="min-w-0 flex-1 truncate" title={f.path}>
                  {f.name}
                </span>
                <span className="text-meta text-muted">{f.folder}</span>
                <span className="text-muted [font-variant-numeric:tabular-nums]">{formatBytes(f.bytes)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmButton
              key={installers.id}
              label={`Mover ${installers.files.length === 1 ? "1 instalador" : `${installers.files.length} instaladores`} a la Papelera`}
              confirmLabel={`Sí, mover ${formatBytes(installers.totalBytes)}`}
              mutation={apply}
              disabled={preview.isPending}
              onConfirm={(done) => apply.mutate(installers.id, { onSettled: done })}
            />
            <span className="text-meta text-muted">Vigente hasta las {until(installers.previewedAt)}.</span>
          </div>
        </>
      )}
    </div>
  );
};

// Mole's runs take minutes, so each one starts on a click and nothing deletes without a preview shown first.
export const MoleCard = () => {
  const { data: report } = useMole();
  if (!report) return null;
  return (
    <section className="grid gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading className="">Limpieza a fondo</Heading>
        <span className="text-meta text-muted">{report.mole.available ? `Mole ${report.mole.version ?? ""}` : "Mole"}</span>
      </div>
      {!report.mole.available ? (
        <p className="text-body text-muted">Mole no está instalado. Instálalo en la Terminal con brew install mole y vuelve a abrir esta página.</p>
      ) : (
        <>
          {report.lastRun && <LastRun run={report.lastRun} />}
          <DiskBlock disk={report.disk} />
          <CleanBlock clean={report.clean} />
          <InstallersBlock installers={report.installers} />
        </>
      )}
    </section>
  );
};
