import { describe, expect, it } from "vitest";

import { nextDue, occurrence } from "./schedule.js";

describe("occurrence", () => {
  it("steps by days, weeks, months and years", () => {
    expect(occurrence("2026-11-02", { every: 1, unit: "day" }, 3)).toBe("2026-11-05");
    expect(occurrence("2026-11-02", { every: 2, unit: "week" }, 1)).toBe("2026-11-16");
    expect(occurrence("2026-11-02", { every: 1, unit: "month" }, 2)).toBe("2027-01-02");
    expect(occurrence("2026-11-02", { every: 1, unit: "year" }, 1)).toBe("2027-11-02");
  });

  it("a series on the 31st falls on the month's last day, and goes back to the 31st after", () => {
    const monthly = { every: 1, unit: "month" } as const;
    expect(occurrence("2026-12-31", monthly, 2)).toBe("2027-02-28");
    expect(occurrence("2026-12-31", monthly, 3)).toBe("2027-03-31");
    expect(occurrence("2026-12-31", monthly, 4)).toBe("2027-04-30");
    expect(occurrence("2028-02-29", { every: 1, unit: "year" }, 1)).toBe("2029-02-28");
  });
});

describe("nextDue", () => {
  const monthly = { every: 1, unit: "month" } as const;

  it("the first one is the anchor itself, when it is not past", () => {
    expect(nextDue("2026-11-05", monthly, null, "2026-11-02")).toBe("2026-11-05");
  });

  it("done early: the next period, not the same one again", () => {
    expect(nextDue("2026-11-05", monthly, "2026-11-05", "2026-11-03")).toBe("2026-12-05");
  });

  it("done late: the periods already past are skipped", () => {
    expect(nextDue("2026-11-05", monthly, "2026-11-05", "2027-01-10")).toBe("2027-02-05");
  });

  it("every 3 days counts from the anchor, not from the day it was done", () => {
    expect(nextDue("2026-11-01", { every: 3, unit: "day" }, "2026-11-04", "2026-11-06")).toBe("2026-11-07");
  });
});
