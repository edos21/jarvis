import { useEffect, useState } from "react";

import { request } from "./api";

export type PushState = "unsupported" | "denied" | "off" | "on" | "working";

const supported = (): boolean =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;

const keyBytes = (base64Url: string): Uint8Array => {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

export const registerServiceWorker = (): void => {
  if (supported()) void navigator.serviceWorker.register("/sw.js");
};

// Notifications for this browser: each device (the phone, the Mac) subscribes on its own.
export const usePush = (): [PushState, () => Promise<void>, string | null] => {
  const [state, setState] = useState<PushState>("working");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"));
  }, []);

  const toggle = async (): Promise<void> => {
    setError(null);
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await request("/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: existing.endpoint }) });
        await existing.unsubscribe();
        return setState("off");
      }
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const { publicKey } = await request<{ publicKey: string }>("/push/key");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey) as BufferSource,
      });
      await request("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("off");
    }
  };

  return [state, toggle, error];
};
