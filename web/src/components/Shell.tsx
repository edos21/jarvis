import { Suspense, lazy, useCallback, useState } from "react";
import {
  Command,
  Ellipsis,
  FileSpreadsheet,
  FileText,
  Laptop,
  ListTodo,
  Mail,
  Newspaper,
  NotebookText,
  Receipt,
  Sunrise,
  Wallet,
} from "lucide-react";

import { useIsRemote } from "@/lib/api";
import { type Route, ROUTES, go, useRoute } from "@/lib/route";
import { CommandBar, useCommandBar } from "./CommandBar";
import { MailPage } from "./MailPage";
import { MacPage } from "./MacPage";
import { MoreSheet } from "./MoreSheet";
import { NewsPage } from "./NewsPage";
import { PaymentsPage } from "./PaymentsPage";
import { ResearchPage } from "./ResearchPage";
import { ThemeToggle, useTheme } from "./ThemeToggle";
import { TodayPage } from "./TodayPage";
import { WalletPage } from "./WalletPage";

const ICONS: Record<Route, typeof Sunrise> = {
  hoy: Sunrise,
  tareas: ListTodo,
  correo: Mail,
  cartera: Wallet,
  noticias: Newspaper,
  analisis: FileText,
  notas: NotebookText,
  cuentas: FileSpreadsheet,
  pagos: Receipt,
  mac: Laptop,
};

// Opened now and then (and Notes and Statements are Mac-only): they load on first visit, not with Today.
const TasksPage = lazy(() => import("./TasksPage").then((m) => ({ default: m.TasksPage })));
const NotesPage = lazy(() => import("./NotesPage").then((m) => ({ default: m.NotesPage })));
const StatementsPage = lazy(() => import("./StatementsPage").then((m) => ({ default: m.StatementsPage })));

const PAGES: Record<Route, React.ComponentType> = {
  hoy: TodayPage,
  tareas: TasksPage,
  correo: MailPage,
  cartera: WalletPage,
  noticias: NewsPage,
  analisis: ResearchPage,
  notas: NotesPage,
  cuentas: StatementsPage,
  pagos: PaymentsPage,
  mac: MacPage,
};

// What fits at a readable size in the phone's bottom bar; the other sections live under "Más".
const PHONE_BAR: readonly Route[] = ["hoy", "tareas", "correo", "cartera"];

// Icon over its name on both screens: at 18px several icons look alike, and a tooltip needs a hover and a wait.
const NAV_ITEM = "flex flex-col items-center gap-0.5 min-w-0 flex-1 rounded-lg px-1 py-1.5 text-meta sm:w-full sm:flex-none sm:py-2";
const navTone = (active: boolean): string => (active ? "bg-accent text-accent-ink" : "text-rail-ink hover:text-rail-strong");

export const Shell = () => {
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [commandOpen, setCommandOpen] = useCommandBar();
  const remote = useIsRemote();
  const Page = PAGES[route];
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const sections = ROUTES.filter((r) => r.nav && !(remote && r.macOnly));
  const moreSections = sections.filter((r) => !PHONE_BAR.includes(r.id)).map((r) => ({ ...r, Icon: ICONS[r.id] }));
  return (
    <div className="flex h-full flex-col-reverse sm:flex-row">
      <nav
        aria-label="Secciones"
        className="flex shrink-0 items-center justify-around gap-1 bg-rail px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:w-[88px] sm:flex-col sm:justify-start sm:overflow-y-auto sm:py-4"
      >
        <span className="mb-3 hidden font-serif text-[22px] text-rail-strong sm:block" aria-hidden>
          J
        </span>
        {sections.map((r) => {
          const Icon = ICONS[r.id];
          const active = r.id === route;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => go(r.id)}
              aria-current={active ? "page" : undefined}
              className={`${NAV_ITEM} ${navTone(active)} ${PHONE_BAR.includes(r.id) ? "" : "max-sm:hidden"}`}
            >
              <Icon size={18} />
              <span>{r.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-current={moreSections.some((r) => r.id === route) ? "page" : undefined}
          className={`${NAV_ITEM} ${navTone(moreSections.some((r) => r.id === route))} sm:hidden`}
        >
          <Ellipsis size={18} />
          <span>Más</span>
        </button>
        <div className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          title="Comandos (⌘K)"
          aria-label="Abrir comandos"
          className="hidden size-10 place-items-center rounded-lg text-rail-ink hover:text-rail-strong sm:grid"
        >
          <Command size={18} />
        </button>
        <div className="max-sm:hidden">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={<p className="p-8 text-muted">Abriendo…</p>}>
          <Page />
        </Suspense>
      </div>
      {moreOpen && (
        <MoreSheet routes={moreSections} current={route} theme={theme} onToggleTheme={toggleTheme} onClose={closeMore} />
      )}
      {commandOpen && <CommandBar onClose={() => setCommandOpen(false)} onToggleTheme={toggleTheme} />}
    </div>
  );
};
