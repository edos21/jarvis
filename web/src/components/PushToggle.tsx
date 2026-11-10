import { usePush } from "@/lib/push";
import { Button } from "./Button";

const LABEL = {
  unsupported: "Este navegador no recibe avisos. En el celular, instala Jarvis como app.",
  denied: "Los avisos están bloqueados en este navegador. Actívalos en su configuración.",
  off: "Este dispositivo no recibe avisos.",
  on: "Este dispositivo recibe avisos.",
  working: "Revisando los avisos…",
} as const;

export const PushToggle = () => {
  const [state, toggle, error] = usePush();
  return (
    <div className="grid gap-2 text-body">
      <p className="text-muted">{LABEL[state]}</p>
      {(state === "off" || state === "on") && (
        <div>
          <Button variant={state === "off" ? "primary" : "plain"} onClick={() => void toggle()}>
            {state === "off" ? "Activar avisos" : "Desactivar avisos"}
          </Button>
        </div>
      )}
      {error && <p className="text-critical">No se pudo: {error}</p>}
    </div>
  );
};
