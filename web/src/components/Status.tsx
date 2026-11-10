import { ArrowDown, ArrowUp, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type React from "react";

import type { Severity } from "../../../shared/mac";

// Three outlines, so a severity can be told apart even where its color can't.
const SEVERITY: Record<Severity, { Icon: LucideIcon; word: string; tone: string }> = {
  critical: { Icon: OctagonAlert, word: "Urgente", tone: "text-critical" },
  warning: { Icon: TriangleAlert, word: "Atención", tone: "text-warning" },
  info: { Icon: Info, word: "Aviso", tone: "text-info" },
};

export const IconText = ({
  Icon,
  tone,
  className = "",
  children,
}: {
  Icon: LucideIcon;
  tone: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <span className={`inline-flex items-start gap-1.5 ${tone} ${className}`}>
    {/* One line tall, so the icon stays with the first line when the text wraps. */}
    <span className="flex h-[1lh] shrink-0 items-center">
      <Icon className="size-[1.05em]" strokeWidth={2.25} aria-hidden />
    </span>
    {/* The only baseline participant, so the group lines up with text beside it instead of with the icon. */}
    <span className="min-w-0 self-baseline">{children}</span>
  </span>
);

export const StatusText = ({
  severity,
  className,
  children,
}: {
  severity: Severity;
  className?: string;
  children: React.ReactNode;
}) => (
  <IconText Icon={SEVERITY[severity].Icon} tone={SEVERITY[severity].tone} className={className}>
    {children}
  </IconText>
);

export const SeverityLabel = ({ severity }: { severity: Severity }) => (
  <StatusText severity={severity} className="text-meta font-medium">
    {SEVERITY[severity].word}
  </StatusText>
);

// Direction as a shape next to the sign; flat or unknown figures get none, matching moveTone.
export const MoveArrow = ({ n }: { n: number | null }) => {
  if (n === null || n === 0) return null;
  const Icon = n > 0 ? ArrowUp : ArrowDown;
  return <Icon className="mr-0.5 inline size-[0.9em] align-[-0.08em]" strokeWidth={2.5} aria-hidden />;
};
