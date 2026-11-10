import { useSyncExternalStore } from "react";

// The same condition Tailwind writes for max-sm, so what JS mounts and what CSS sizes always agree.
const PHONE_WIDTH = "(width < 40rem)";

const subscribe = (notify: () => void): (() => void) => {
  const query = window.matchMedia(PHONE_WIDTH);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

export const useIsPhone = (): boolean => useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_WIDTH).matches);
