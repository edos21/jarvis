import { localDate } from "../../../shared/dates.js";
import type { AgendaItem, AgendaResponse } from "../../../shared/calendar.js";
import type { StoredAccount } from "./accounts.js";
import { googleRequest } from "./api.js";
import { GoogleAuthExpired, type GoogleAuth } from "./oauth.js";

type EventTime = { date?: string; dateTime?: string };

type CalendarEvent = {
  id: string;
  summary?: string;
  location?: string;
  htmlLink: string;
  start: EventTime;
  end: EventTime;
  attendees?: { self?: boolean; responseStatus?: string }[];
};

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type Account = Pick<StoredAccount, "email" | "refreshToken">;

const dayBounds = (now: Date): { start: Date; end: Date } => {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { start, end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) };
};

// All-day dates are calendar days (end exclusive); timed events are instants that overlap the local day.
const overlapsDay = (e: CalendarEvent, now: Date): boolean => {
  if (e.start.date && e.end.date) {
    const today = localDate(now);
    return e.start.date <= today && today < e.end.date;
  }
  const { start, end } = dayBounds(now);
  return Date.parse(e.start.dateTime ?? "") < end.getTime() && Date.parse(e.end.dateTime ?? "") > start.getTime();
};

const toItem = (e: CalendarEvent): AgendaItem => ({
  id: e.id,
  title: e.summary?.trim() || "(sin título)",
  start: e.start.dateTime ?? e.start.date ?? "",
  end: e.end.dateTime ?? e.end.date ?? "",
  allDay: Boolean(e.start.date),
  location: e.location?.trim() || null,
  url: e.htmlLink,
});

export const readAgenda = async (
  accounts: Account[],
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  now: Date,
): Promise<Pick<AgendaResponse, "items" | "reconnect">> => {
  const { start, end } = dayBounds(now);
  const items: AgendaItem[] = [];
  const reconnect: string[] = [];
  for (const account of accounts) {
    const url = new URL(EVENTS_URL);
    url.search = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "50",
    }).toString();
    try {
      const { items: events = [] } = await googleRequest<{ items?: CalendarEvent[] }>(auth, account, fetchFn, url.toString());
      for (const e of events) {
        if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
        if (overlapsDay(e, now)) items.push(toItem(e));
      }
    } catch (error) {
      if (error instanceof GoogleAuthExpired) reconnect.push(account.email);
      else throw error;
    }
  }
  const sortKey = (i: AgendaItem): string => (i.allDay ? "0" : `1${new Date(i.start).toISOString()}`);
  return { items: items.sort((a, b) => sortKey(a).localeCompare(sortKey(b))), reconnect };
};
