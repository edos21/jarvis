import { useState } from "react";

import { type StatementCsv, type StatementCsvFile, isStatementDate } from "../../../shared/statements";
import { useImportStatement, useRevealStatementCsv, useSaveStatementCsv, useStatementCsv, useStatementCsvs } from "@/lib/api";
import { amountIn, dateTimeOf } from "@/lib/format";
import { go, useRouteParam, useUnsavedGuard } from "@/lib/route";
import { Button, MutationButton } from "./Button";
import { SpendingChart } from "./SpendingChart";
import { StatusText } from "./Status";

const cellClass =
  "w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-body text-ink hover:border-line focus:border-accent focus:bg-surface";


// The script names the issuer in lower case; the label only capitalizes it.
const labelOf = (f: StatementCsvFile): string => `${f.issuer.charAt(0).toUpperCase()}${f.issuer.slice(1)} ${f.currency}`;

// Amounts are edited as text so "12,5" can be typed; a row is only valid once its date and amount parse.
type Draft = { date: string; description: string; amount: string };

const toDraft = (csv: StatementCsv): Draft[] => csv.rows.map((r) => ({ date: r.date, description: r.description, amount: r.amount.toFixed(2) }));
const amountOf = (text: string): number => Number(text.trim().replace(",", "."));
const validRow = (d: Draft): boolean => isStatementDate(d.date) && d.description.trim() !== "" && d.amount.trim() !== "" && Number.isFinite(amountOf(d.amount));

const Upload = () => {
  const upload = useImportStatement();
  const [over, setOver] = useState(false);
  const send = (file: File | undefined) => file && upload.mutate(file, { onSuccess: (r) => r.outputs[0] && go("cuentas", r.outputs[0].file) });
  return (
    <div className="grid gap-2">
      <label
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          send(e.dataTransfer.files[0]);
        }}
        className={`grid cursor-pointer gap-1 rounded-lg border border-dashed px-4 py-5 text-center text-body ${over ? "border-accent bg-highlight" : "border-line"}`}
      >
        <span className="font-medium">{upload.isPending ? "Procesando…" : "Subir estado de cuenta"}</span>
        <span className="text-body text-muted">El PDF o el .numbers del estado de cuenta. Arrástralo aquí o haz clic.</span>
        <input
          type="file"
          accept=".pdf,.numbers"
          className="sr-only"
          disabled={upload.isPending}
          onChange={(e) => {
            send(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {upload.error && <p className="text-body text-critical">{upload.error.message}</p>}
      {upload.data && (
        <div className="grid gap-1 text-body">
          <p>
            Guardado como <b>{upload.data.statement}</b>.{" "}
            {upload.data.outputs.length === 0 ? "No salió ningún CSV." : `${upload.data.outputs.length} CSV listo${upload.data.outputs.length > 1 ? "s" : ""}.`}
          </p>
          {upload.data.skipped.map((s) => (
            <p key={s} className="text-muted">
              Se saltó: {s}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

const CsvEditor = ({ csv }: { csv: StatementCsv }) => {
  const save = useSaveStatementCsv();
  const reveal = useRevealStatementCsv();
  const [rows, setRows] = useState<Draft[]>(() => toDraft(csv));
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const valid = rows.every(validRow);
  const total = rows.reduce((sum, r) => sum + (Number.isFinite(amountOf(r.amount)) ? amountOf(r.amount) : 0), 0);
  const update = (i: number, change: Partial<Draft>) => {
    setRows((current) => current.map((r, j) => (j === i ? { ...r, ...change } : r)));
    setDirty(true);
  };
  // mutateAsync: a save gives the editor a new key, and a mutate callback would not survive that remount.
  const persist = () =>
    save.mutateAsync({
      file: csv.file,
      mtimeMs: csv.mtimeMs,
      rows: rows.map((r) => ({ date: r.date, description: r.description.trim(), amount: amountOf(r.amount) })),
    });
  const download = () => window.location.assign(`/api/statements/csv/download?file=${encodeURIComponent(csv.file)}`);
  return (
    <article className="grid content-start gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[24px] leading-tight">{labelOf(csv)}</h2>
          <p className="text-meta text-muted">
            {csv.file} · {dateTimeOf(new Date(csv.mtimeMs).toISOString())}
          </p>
        </div>
        <MutationButton mutation={save} variant="primary" disabled={!dirty || !valid} onClick={() => void persist().catch(() => undefined)}>
          Guardar
        </MutationButton>
        <Button onClick={() => (dirty ? void persist().then(download, () => undefined) : download())} disabled={dirty && !valid}>
          Descargar CSV
        </Button>
        <MutationButton mutation={reveal} onClick={() => reveal.mutate(csv.file)}>
          Mostrar en Finder
        </MutationButton>
      </header>
      {dirty && !valid && (
        <p className="text-body">
          <StatusText severity="critical">Revisa las filas marcadas: fecha dd/mm/aaaa, descripción y monto.</StatusText>
        </p>
      )}
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-line text-left text-meta text-muted">
            <th className="w-32 py-1.5 font-medium">Fecha</th>
            <th className="py-1.5 font-medium">Descripción</th>
            <th className="w-32 py-1.5 text-right font-medium">Monto</th>
            <th className="w-32" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b border-line/60 ${validRow(r) ? "" : "bg-critical/10"}`}>
              <td>
                <input aria-label={`Fecha, fila ${i + 1}`} className={cellClass} value={r.date} onChange={(e) => update(i, { date: e.target.value })} />
              </td>
              <td>
                <input aria-label={`Descripción, fila ${i + 1}`} className={cellClass} value={r.description} onChange={(e) => update(i, { description: e.target.value })} />
              </td>
              <td>
                <input
                  aria-label={`Monto, fila ${i + 1}`}
                  inputMode="decimal"
                  className={`${cellClass} text-right tabular-nums`}
                  value={r.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                />
              </td>
              <td className="text-right">
                {!validRow(r) && (
                  <StatusText severity="critical" className="align-middle text-meta">
                    Revisar
                  </StatusText>
                )}
                <button
                  type="button"
                  aria-label={`Borrar fila ${i + 1}`}
                  title="Borrar fila"
                  className="rounded px-2 py-1 text-muted hover:text-critical"
                  onClick={() => {
                    setRows((current) => current.filter((_, j) => j !== i));
                    setDirty(true);
                  }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="py-2">
              <Button
                onClick={() => {
                  setRows((current) => [...current, { date: current.at(-1)?.date ?? "", description: "", amount: "" }]);
                  setDirty(true);
                }}
              >
                Agregar fila
              </Button>
            </td>
            <td className="py-2 text-right font-medium tabular-nums">{amountIn(total, csv.currency)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="text-body text-muted">
        {rows.length} filas. Al guardar se reemplaza el CSV en cuentas/files/out y la versión anterior queda en ~/.jarvis/backups.
      </p>
    </article>
  );
};

const CsvView = ({ file }: { file: string }) => {
  const { data, error } = useStatementCsv(file);
  if (error) return <p className="text-critical">No pude abrir el CSV: {error.message}</p>;
  if (!data) return <p className="text-muted">Abriendo…</p>;
  // A new key per saved version starts the editor from what is on disk.
  return <CsvEditor key={`${data.file}:${data.mtimeMs}`} csv={data} />;
};

export const StatementsPage = () => {
  const selected = useRouteParam();
  const { data, error } = useStatementCsvs();
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[18rem_1fr]">
      <section className="grid content-start gap-3">
        <h1 className="font-serif text-[28px] leading-tight">Cuentas</h1>
        <Upload />
        {error && <p className="text-critical">{error.message}</p>}
        <ul className="grid gap-0.5">
          {data?.map((f) => (
            <li key={f.file}>
              <button
                type="button"
                onClick={() => go("cuentas", f.file)}
                aria-current={f.file === selected ? "true" : undefined}
                className={`grid w-full gap-0.5 rounded-md px-3 py-1.5 text-left ${f.file === selected ? "bg-highlight" : "hover:bg-surface"}`}
              >
                <span className="text-body font-medium">{labelOf(f)}</span>
                <span className="truncate text-meta text-muted">
                  {f.file} · {dateTimeOf(new Date(f.mtimeMs).toISOString())}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid min-w-0 content-start gap-4">
        {selected ? (
          <CsvView file={selected} />
        ) : (
          <>
            <SpendingChart />
            <p className="text-muted">Sube un estado de cuenta o elige un CSV para revisarlo.</p>
          </>
        )}
      </section>
    </main>
  );
};
