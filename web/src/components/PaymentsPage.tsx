import { useState } from "react";

import type { Currency, Payment, PaymentInput } from "../../../shared/payments";
import { useDeletePayment, useIsRemote, usePayments, useSavePayment, useUndoPaid } from "@/lib/api";
import { amountIn } from "@/lib/format";
import { localPeriod } from "../../../shared/dates";
import { Button, LinkButton, MutationButton, fieldClass } from "./Button";

const EMPTY: PaymentInput = {
  name: "",
  amount: null,
  currency: "UYU",
  dueDay: 1,
  link: null,
  accountLabel: null,
  accountNumber: null,
};

const Field = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
  <label htmlFor={id} className="grid gap-1 text-meta font-medium text-muted">
    {label}
    {children}
  </label>
);

const PaymentForm = ({ initial, id, onDone }: { initial: PaymentInput; id: number | null; onDone: () => void }) => {
  const [form, setForm] = useState<PaymentInput>(initial);
  // Kept as typed: parsing on every keystroke would eat "950." and turn "950,5" into NaN.
  const [amountText, setAmountText] = useState(initial.amount === null ? "" : String(initial.amount));
  const [amountError, setAmountError] = useState<string | null>(null);
  const save = useSavePayment();
  const set = <K extends keyof PaymentInput>(key: K, value: PaymentInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (v: string): string | null => (v.trim() === "" ? null : v);
  return (
    <form
      className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const raw = amountText.trim().replace(",", ".");
        const amount = raw === "" ? null : Number(raw);
        if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
          setAmountError("El monto debe ser un número, por ejemplo 950 o 950,50.");
          return;
        }
        setAmountError(null);
        save.mutate({ id, input: { ...form, amount } }, { onSuccess: onDone });
      }}
    >
      <Field id="payment-name" label="Nombre">
        <input id="payment-name" className={fieldClass} value={form.name} placeholder="Alquiler" required onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid grid-cols-[1fr_5.5rem_5rem] gap-2">
        <Field id="payment-amount" label="Monto">
          <input
            id="payment-amount"
            className={fieldClass}
            inputMode="decimal"
            value={amountText}
            placeholder="Opcional"
            onChange={(e) => setAmountText(e.target.value)}
          />
        </Field>
        <Field id="payment-currency" label="Moneda">
          <select id="payment-currency" className={fieldClass} value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field id="payment-day" label="Vence el día">
          <input
            id="payment-day"
            className={fieldClass}
            type="number"
            min={1}
            max={31}
            value={form.dueDay}
            onChange={(e) => set("dueDay", Number(e.target.value))}
          />
        </Field>
      </div>
      <Field id="payment-link" label="Link para pagar">
        <input id="payment-link" className={fieldClass} value={form.link ?? ""} placeholder="https://…" onChange={(e) => set("link", text(e.target.value))} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field id="payment-account-label" label="Banco o destino">
          <input id="payment-account-label" className={fieldClass} value={form.accountLabel ?? ""} placeholder="Banco" onChange={(e) => set("accountLabel", text(e.target.value))} />
        </Field>
        <Field id="payment-account" label="Cuenta a la que giras">
          <input id="payment-account" className={fieldClass} value={form.accountNumber ?? ""} placeholder="Opcional" onChange={(e) => set("accountNumber", text(e.target.value))} />
        </Field>
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {id === null ? "Agregar pago" : "Guardar cambios"}
        </Button>
        <Button onClick={onDone}>Cancelar</Button>
        {(amountError ?? save.error) && (
          <span className="text-body text-critical">{amountError ?? save.error?.message}</span>
        )}
      </div>
    </form>
  );
};

const toInput = ({ name, amount, currency, dueDay, link, accountLabel, accountNumber }: Payment): PaymentInput => ({
  name,
  amount,
  currency,
  dueDay,
  link,
  accountLabel,
  accountNumber,
});

export const PaymentsPage = () => {
  const { data, error, isLoading } = usePayments();
  const remove = useDeletePayment();
  // A payment carries its account and feeds Today's reminders: deleting one asks first, one row at a time.
  const [deleting, setDeleting] = useState<number | null>(null);
  const undo = useUndoPaid();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const remote = useIsRemote();
  if (isLoading) return <p className="p-8 text-muted">Cargando…</p>;
  if (error || !data) return <p className="p-8 text-critical">No pude cargar los pagos: {error?.message}</p>;
  const period = localPeriod(new Date());
  const paidNow = new Set(data.paidThisPeriod);
  return (
    <main className="mx-auto grid max-w-3xl content-start gap-5 px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[28px] leading-tight">Pagos</h1>
          <p className="text-body text-muted">
            Aparecen en Hoy cinco días antes de vencer y se quedan hasta que los marques pagados.
            {remote && " Se agregan y editan desde la Mac."}
          </p>
        </div>
        {editing === null && !remote && (
          <Button variant="primary" onClick={() => setEditing("new")}>
            Agregar pago
          </Button>
        )}
      </header>
      {editing === "new" && <PaymentForm initial={EMPTY} id={null} onDone={() => setEditing(null)} />}
      {data.payments.length === 0 && editing === null ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-muted">
          Aún no hay pagos. Agrega el primero con su día de vencimiento y el link para pagarlo.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {data.payments.map((p) =>
            editing === p.id ? (
              <li key={p.id}>
                <PaymentForm initial={toInput(p)} id={p.id} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-body font-semibold">{p.name}</p>
                  <p className="text-meta text-muted [font-variant-numeric:tabular-nums]">
                    Vence el {p.dueDay} de cada mes
                    {p.amount !== null && ` · ${amountIn(p.amount, p.currency)}`}
                    {p.accountLabel && ` · ${p.accountLabel}`}
                    {p.accountNumber && ` · ${p.accountNumber}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 max-sm:gap-2">
                  {paidNow.has(p.id) && (
                    <Button onClick={() => undo.mutate({ paymentId: p.id, period })} title="Si lo marcaste pagado por error">
                      Pagado este mes · deshacer
                    </Button>
                  )}
                  {p.link && <LinkButton href={p.link}>Abrir</LinkButton>}
                  {!remote && (
                    <>
                      <Button onClick={() => setEditing(p.id)}>Editar</Button>
                      {deleting === p.id ? (
                        <>
                          <MutationButton
                            variant="danger"
                            mutation={remove}
                            onClick={() => remove.mutate(p.id, { onSuccess: () => setDeleting(null) })}
                          >
                            Sí, borrar
                          </MutationButton>
                          <Button onClick={() => setDeleting(null)}>No</Button>
                        </>
                      ) : (
                        <Button variant="danger" onClick={() => setDeleting(p.id)}>
                          Borrar
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </main>
  );
};
