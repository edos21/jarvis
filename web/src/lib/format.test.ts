import { describe, expect, it } from "vitest";

import { amountIn, count, pct, signedPct, usd } from "./format";

describe("amounts", () => {
  it("write every currency after the number, USD included", () => {
    expect(amountIn(680, "EUR")).toBe("680,00 EUR");
    expect(amountIn(0.42, "USD")).toBe("0,42 USD");
    expect(amountIn(32500, "UYU")).toBe("32.500,00 UYU");
  });

  it("round dollar totals to whole units the same way", () => {
    expect(usd(43000.4)).toBe("43.000 USD");
  });
});

describe("shares and counts", () => {
  it("use a decimal comma for a weight", () => {
    expect(pct(42.13)).toBe("42,1%");
    expect(signedPct(0.5)).toBe("+0,5%");
  });

  it("group thousands in every count", () => {
    expect(count(1692)).toBe("1.692");
  });
});
