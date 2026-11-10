import { useState } from "react";

import type { CardAction, TodayCard as Card } from "../../../shared/today";
import { useCompleteTask, useMacAction, useMailSelectionAction, useMarkPaid } from "@/lib/api";
import { copyText, severityStripe } from "@/lib/format";
import { Button, LinkButton, MutationButton } from "./Button";
import { InvestigateButton } from "./InvestigateButton";
import { NotPersonButton } from "./NotPersonButton";
import { PostponeButton } from "./PostponeButton";
import { SeverityLabel } from "./Status";

const Action = ({ action, primary }: { action: CardAction; primary: boolean }) => {
  const markPaid = useMarkPaid();
  const mac = useMacAction();
  const archive = useMailSelectionAction();
  const complete = useCompleteTask();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  switch (action.kind) {
    case "link":
      return <LinkButton href={action.url}>{action.label}</LinkButton>;
    case "copy":
      return (
        <Button
          onClick={async () => {
            if (await copyText(action.text)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? "Copiado" : action.label}
        </Button>
      );
    case "mark_paid":
      return (
        <Button
          variant={primary ? "primary" : "plain"}
          disabled={markPaid.isPending}
          onClick={() => markPaid.mutate({ paymentId: action.paymentId, period: action.period })}
        >
          {action.label}
        </Button>
      );
    case "archive_mail":
      return (
        <MutationButton
          mutation={archive}
          onClick={() => archive.mutate({ account: action.account, ids: [action.messageId], action: "archive" })}
        >
          {action.label}
        </MutationButton>
      );
    case "not_person":
      return <NotPersonButton account={action.account} messageId={action.messageId} entry={action.entry} />;
    case "investigate":
      return <InvestigateButton subject={action.subject} label={action.label} />;
    case "complete_task":
      return (
        <MutationButton
          mutation={complete}
          variant={primary ? "primary" : "plain"}
          onClick={() => complete.mutate({ account: action.account, listId: action.listId, taskId: action.taskId })}
        >
          {action.label}
        </MutationButton>
      );
    case "postpone_task":
      return <PostponeButton account={action.account} listId={action.listId} taskId={action.taskId} />;
    case "mac_cta":
      if (action.cta.kind !== "kill") {
        return <Button onClick={() => mac.mutate(action.cta)}>{action.label}</Button>;
      }
      return confirming ? (
        <span className="inline-flex items-center gap-1.5 max-sm:gap-2">
          <Button variant="danger" onClick={() => mac.mutate(action.cta)} disabled={mac.isPending}>
            Sí, cerrar {action.cta.name}
          </Button>
          <Button onClick={() => setConfirming(false)}>No</Button>
        </span>
      ) : (
        <Button onClick={() => setConfirming(true)}>{action.label}</Button>
      );
  }
};

export const TodayCard = ({ card }: { card: Card }) => (
  <article
    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-l-4 border-line bg-surface px-4 py-3"
    style={severityStripe(card.severity)}
  >
    <div className="min-w-0 flex-1 basis-60">
      <SeverityLabel severity={card.severity} />
      <h2 className="text-title font-semibold">{card.title}</h2>
      {card.detail && <p className="mt-0.5 text-body text-muted [font-variant-numeric:tabular-nums]">{card.detail}</p>}
    </div>
    {card.actions.length > 0 && (
      <div className="flex flex-wrap gap-1.5 max-sm:gap-2">
        {card.actions.map((action, i) => (
          <Action key={`${action.kind}-${i}`} action={action} primary={i === card.actions.length - 1} />
        ))}
      </div>
    )}
  </article>
);
