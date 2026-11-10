import type { MacStatus, MacSuggestion, Severity, StuckReason } from "../../../shared/mac.js";

export const SOFTWARE_UPDATE_URL = "x-apple.systempreferences:com.apple.Software-Update-Settings.extension";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const STUCK_DETAIL: Record<Exclude<StuckReason, "zombie">, string> = {
  uninterruptible: "Lleva rato esperando al disco o a la red y no responde.",
  runaway_cpu: "Usa más del 90% de CPU desde hace varios minutos.",
};

const shortName = (path: string): string => path.split("/").at(-1) ?? path;

export const suggestForMac = (s: MacStatus): MacSuggestion[] => {
  const out: MacSuggestion[] = [];
  if (s.diskPct >= 85) {
    out.push({
      key: "disk",
      severity: s.diskPct >= 95 ? "critical" : "warning",
      title: `Disco al ${s.diskPct}%`,
      detail: `Quedan ${s.diskFreeGb} GB libres. Conviene liberar espacio antes de que macOS empiece a fallar.`,
      cta: null,
    });
  }
  if (s.uptimeDays >= 7) {
    out.push({
      key: "uptime",
      severity: s.uptimeDays >= 21 ? "critical" : "warning",
      title: `${s.uptimeDays} días sin reiniciar`,
      detail: "Reiniciar libera memoria y aplica las actualizaciones pendientes.",
      cta: null,
    });
  }
  if (s.memPct >= 90) {
    out.push({
      key: "memory",
      severity: "warning",
      title: `Memoria al ${s.memPct}%`,
      detail: "Revisa qué está consumiendo memoria en el Monitor de Actividad.",
      cta: { kind: "open_app", app: "Activity Monitor" },
    });
  }
  // Zombies are left out: they hold no resources and only their parent can reap them.
  for (const p of s.stuck) {
    if (p.reason === "zombie") continue;
    out.push({
      key: `stuck:${p.pid}`,
      severity: "warning",
      title: `${shortName(p.name)} parece colgado`,
      detail: STUCK_DETAIL[p.reason],
      cta: { kind: "kill", pid: p.pid, name: shortName(p.name) },
    });
  }
  if (s.updates && s.updates.length > 0) {
    out.push({
      key: "updates",
      severity: "info",
      title: s.updates.length === 1 ? "1 actualización pendiente" : `${s.updates.length} actualizaciones pendientes`,
      detail: s.updates.join(", "),
      cta: { kind: "open_url", url: SOFTWARE_UPDATE_URL },
    });
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
};
