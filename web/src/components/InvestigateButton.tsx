import type { ResearchSubject } from "../../../shared/research";
import { useStartResearch } from "@/lib/api";
import { MutationButton } from "./Button";

// Starts an agent run and opens it in Análisis; the run keeps going if I leave the page.
export const InvestigateButton = ({ subject, label = "Investigar" }: { subject: ResearchSubject; label?: string }) => {
  const start = useStartResearch();
  return (
    <MutationButton mutation={start} onClick={() => start.mutate({ kind: "investigate", subject })}>
      {start.isPending ? "Lanzando…" : label}
    </MutationButton>
  );
};
