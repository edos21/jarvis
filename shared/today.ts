import type { AgendaResponse } from "./calendar.js";
import type { MacCta, MacStatus, Severity } from "./mac.js";
import type { ResearchSubject } from "./research.js";
import type { WalletResponse } from "./wallet.js";
import type { WorkSummary } from "./work.js";

export type CardSource = "payments" | "agenda" | "mail" | "wallet" | "work" | "mac";

export type CardAction =
  | { kind: "copy"; label: string; text: string }
  | { kind: "link"; label: string; url: string }
  | { kind: "mark_paid"; label: string; paymentId: number; period: string }
  | { kind: "mac_cta"; label: string; cta: MacCta }
  | { kind: "archive_mail"; label: string; account: string; messageId: string }
  // entry: what the automated-senders file will get, a domain or one address.
  | { kind: "not_person"; label: string; account: string; messageId: string; entry: string }
  | { kind: "investigate"; label: string; subject: ResearchSubject }
  | { kind: "complete_task"; label: string; account: string; listId: string; taskId: string }
  | { kind: "postpone_task"; label: string; account: string; listId: string; taskId: string };

export type TodayCard = {
  key: string;
  severity: Severity;
  source: CardSource;
  title: string;
  detail: string;
  actions: CardAction[];
};

// ready: the briefing matches today's data; pending: being written (text may be the previous one);
// unavailable: Claude could not write it, the cards stand on their own.
export type BriefingStatus = "ready" | "pending" | "unavailable";

export type TodayResponse = {
  greeting: string;
  dateLabel: string;
  briefing: string | null;
  briefingStatus: BriefingStatus;
  // Jarvis can speak the briefing (an ElevenLabs key is set).
  briefingVoice: boolean;
  // I already read today's briefing on some screen: later glances lead with what needs me, the briefing folds.
  briefingSeen: boolean;
  cards: TodayCard[];
  side: { agenda: AgendaResponse | null; wallet: WalletResponse | null; work: WorkSummary | null; mac: MacStatus | null };
  sourceErrors: CardSource[];
  generatedAt: string;
};
