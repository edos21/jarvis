import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import webpush from "web-push";

export type VapidKeys = { publicKey: string; privateKey: string };

// Created once and kept: a new key pair would orphan every browser already subscribed.
export const loadOrCreateVapid = (dataDir: string): VapidKeys => {
  const file = join(dataDir, "vapid.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as VapidKeys;
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  chmodSync(file, 0o600);
  return keys;
};
