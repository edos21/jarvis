import { useState } from "react";

import { useNotPerson } from "@/lib/api";
import { Button, MutationButton } from "./Button";

// Adding one address is a click; silencing a whole domain says which one and asks first.
export const NotPersonButton = ({ account, messageId, entry }: { account: string; messageId: string; entry: string }) => {
  const notPerson = useNotPerson();
  const [confirming, setConfirming] = useState(false);
  const run = () => notPerson.mutate({ account, messageId }, { onSettled: () => setConfirming(false) });

  if (entry.includes("@")) {
    return (
      <MutationButton mutation={notPerson} onClick={run}>
        No es una persona
      </MutationButton>
    );
  }
  return confirming ? (
    <span className="inline-flex flex-wrap items-center gap-1.5 max-sm:gap-2">
      <span className="text-meta text-muted">¿Todo {entry} es automático?</span>
      <MutationButton mutation={notPerson} variant="primary" onClick={run}>
        Sí
      </MutationButton>
      <Button onClick={() => setConfirming(false)}>No</Button>
    </span>
  ) : (
    <Button onClick={() => setConfirming(true)}>No es una persona</Button>
  );
};
