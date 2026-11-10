import { Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { type Route, go } from "@/lib/route";
import type { Theme } from "@/lib/theme";

const ROW = "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-body font-medium";

// The sections that don't fit in the phone's bottom bar, and the theme.
export const MoreSheet = ({
  routes,
  current,
  theme,
  onToggleTheme,
  onClose,
}: {
  routes: { id: Route; label: string; Icon: LucideIcon }[];
  current: Route;
  theme: Theme;
  onToggleTheme: () => void;
  onClose: () => void;
}) => {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ThemeIcon = theme === "dark" ? Sun : Moon;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30 sm:hidden" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Más secciones"
        tabIndex={-1}
        className="w-full rounded-t-xl border-t border-line bg-surface px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-ink focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <ul>
          {routes.map(({ id, label, Icon }) => {
            const active = id === current;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  className={`${ROW} ${active ? "bg-accent text-accent-ink" : ""}`}
                  onClick={() => {
                    go(id);
                    onClose();
                  }}
                >
                  <Icon size={20} aria-hidden />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-1 border-t border-line pt-1">
          <button type="button" className={ROW} onClick={onToggleTheme}>
            <ThemeIcon size={20} aria-hidden />
            {theme === "dark" ? "Modo claro" : "Modo oscuro"}
          </button>
        </div>
      </div>
    </div>
  );
};
