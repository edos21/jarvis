import { useEffect, useState } from "react";

export type Route = "hoy" | "tareas" | "correo" | "cartera" | "noticias" | "analisis" | "notas" | "cuentas" | "pagos" | "mac";

// nav: false keeps a page out of the rail; it is opened from other pages (an analysis from Cartera or Noticias).
// macOnly: the page's data never leaves the Mac, so the phone does not list it.
export const ROUTES: { id: Route; label: string; nav: boolean; macOnly?: boolean }[] = [
  { id: "hoy", label: "Hoy", nav: true },
  { id: "tareas", label: "Tareas", nav: true },
  { id: "correo", label: "Correo", nav: true },
  { id: "cartera", label: "Cartera", nav: true },
  { id: "noticias", label: "Noticias", nav: true },
  { id: "analisis", label: "Análisis", nav: false },
  { id: "notas", label: "Notas", nav: true, macOnly: true },
  { id: "cuentas", label: "Cuentas", nav: true, macOnly: true },
  { id: "pagos", label: "Pagos", nav: true },
  { id: "mac", label: "Mac", nav: true },
];

// "#analisis/12": the route, then an optional id the page reads with useRouteParam.
const segments = (hash: string): string[] => hash.replace("#", "").split("/");

const parse = (hash: string): Route => {
  const [id] = segments(hash);
  return ROUTES.some((r) => r.id === id) ? (id as Route) : "hoy";
};

// The param is encoded whole, so a note's path ("Inversiones/cartera.md") stays one segment.
export const routeHref = (route: Route, param?: string | number): string =>
  param === undefined ? `#${route}` : `#${route}/${encodeURIComponent(param)}`;

// An editor with unsaved changes registers itself here, so moving to another page asks first.
let unsaved = false;

export const useUnsavedGuard = (dirty: boolean): void => {
  useEffect(() => {
    if (!dirty) return;
    unsaved = true;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      unsaved = false;
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);
};

export const go = (route: Route, param?: string | number): void => {
  const href = routeHref(route, param);
  if (href === window.location.hash) return;
  if (unsaved && !window.confirm("Tienes cambios sin guardar. ¿Salir igual?")) return;
  window.location.hash = href;
};

const useHash = (): string => {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
};

export const useRoute = (): Route => parse(useHash());

export const useRouteParam = (): string | null => {
  const param = segments(useHash())[1];
  if (param === undefined) return null;
  try {
    return decodeURIComponent(param);
  } catch {
    return null;
  }
};
