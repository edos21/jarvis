import { useDisconnectGoogle, useGoogleStatus, useIsRemote } from "@/lib/api";
import { Button } from "./Button";

// Where Google is set up: the steps when it is not configured, the connect button, and the connected accounts.
export const GoogleConnect = ({ compact = false }: { compact?: boolean }) => {
  const { data } = useGoogleStatus();
  const remote = useIsRemote();
  const disconnect = useDisconnectGoogle();
  if (!data) return null;

  if (!data.configured) {
    return (
      <div className="grid gap-2 rounded-lg border border-dashed border-line bg-surface p-4 text-body">
        <p className="font-semibold">Falta configurar Google</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>En console.cloud.google.com crea un proyecto y habilita Gmail API, Google Calendar API y Google Tasks API.</li>
          <li>En la pantalla de consentimiento elige External, agrega los permisos y publícala.</li>
          <li>Crea un OAuth client ID de tipo Desktop app.</li>
          <li>
            Pon <code className="font-mono text-meta">JARVIS_GOOGLE_CLIENT_ID</code> y{" "}
            <code className="font-mono text-meta">JARVIS_GOOGLE_CLIENT_SECRET</code> en ~/.jarvis/env y reinicia Jarvis.
          </li>
        </ol>
      </div>
    );
  }

  if (data.accounts.length === 0) {
    return (
      <div className="grid gap-2 rounded-lg border border-dashed border-line bg-surface p-4 text-body">
        <p>Conecta tu Gmail personal para ver tu correo y tu agenda aquí.</p>
        {remote ? (
          <p className="text-muted">Se conecta desde la Mac.</p>
        ) : (
          <div>
            <a
              href="/api/google/connect?kind=personal"
              className="inline-flex rounded-md border border-accent bg-accent px-2.5 py-1 text-body font-medium text-accent-ink"
            >
              Conectar Gmail personal
            </a>
          </div>
        )}
      </div>
    );
  }

  if (compact) return null;
  return (
    <ul className="grid gap-1 text-meta text-muted">
      {data.accounts.map((a) => (
        <li key={a.email} className="flex flex-wrap items-center gap-2">
          <span>Conectado: {a.email}</span>
          {!remote && (
            <Button variant="danger" onClick={() => disconnect.mutate(a.email)} disabled={disconnect.isPending}>
              Desconectar
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};
