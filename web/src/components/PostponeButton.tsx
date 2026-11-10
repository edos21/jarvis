import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PostponeDays } from "../../../shared/tasks";
import { usePostponeTask } from "@/lib/api";
import { disabledControl, touchTarget } from "./Button";

const MORE: { days: PostponeDays; label: string }[] = [
  { days: 3, label: "3 días" },
  { days: 7, label: "1 semana" },
  { days: 15, label: "15 días" },
];

const SEGMENT = `${touchTarget} whitespace-nowrap border border-control bg-surface px-2.5 py-1 text-body font-medium text-ink transition-colors hover:border-accent ${disabledControl}`;

// "Mañana" in one click; the arrow opens the longer ones. Days count from today, not from when it was due.
export const PostponeButton = ({ account, listId, taskId }: { account: string; listId: string; taskId: string }) => {
  const postpone = usePostponeTask();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (days: PostponeDays) => {
    setOpen(false);
    postpone.mutate({ account, listId, taskId, days });
  };

  return (
    <span ref={box} className="relative inline-flex items-center gap-1.5">
      <span className="inline-flex">
        <button type="button" className={`${SEGMENT} rounded-l-md`} disabled={postpone.isPending} onClick={() => go(1)}>
          Mañana
        </button>
        <button
          type="button"
          aria-label="Posponer más días"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`${SEGMENT} -ml-px rounded-r-md px-1.5 max-sm:min-w-11`}
          disabled={postpone.isPending}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={14} className="mx-auto" />
        </button>
      </span>
      {open && (
        <span role="menu" className="absolute left-0 top-full z-10 mt-1 grid min-w-[8rem] rounded-md border border-line bg-surface py-1 shadow-lg">
          {MORE.map((m) => (
            <button
              key={m.days}
              type="button"
              role="menuitem"
              className={`px-3 py-1.5 text-left text-body hover:bg-accent/10 focus:bg-accent/10 focus:outline-none ${touchTarget}`}
              onClick={() => go(m.days)}
            >
              {m.label}
            </button>
          ))}
        </span>
      )}
      {postpone.error && <span className="text-meta text-critical">{postpone.error.message}</span>}
    </span>
  );
};
