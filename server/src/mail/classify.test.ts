import { describe, expect, it } from "vitest";

import { automatedEntryFor } from "../../../shared/mail.js";
import { DEFAULT_AUTOMATED_DOMAINS, classifyMail, parseFrom } from "./classify.js";

const classify = (headers: Record<string, string>, domains = DEFAULT_AUTOMATED_DOMAINS, labels: string[] = []) =>
  classifyMail(new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), labels, domains);

describe("classifyMail", () => {
  it("List-Unsubscribe is a newsletter", () => {
    expect(classify({ From: "News <hello@substack.com>", Subject: "Weekly", "List-Unsubscribe": "<mailto:x>" })).toBe(
      "newsletter",
    );
    expect(classify({ From: "a@b.com", Subject: "x", Precedence: "bulk" })).toBe("newsletter");
  });

  it("invoice subject from noreply is an invoice", () => {
    expect(classify({ From: "UTE <noreply@ute.com.uy>", Subject: "Tu factura de octubre" })).toBe("invoice");
    expect(classify({ From: "billing@aws.com", Subject: "Your AWS Invoice" })).toBe("invoice");
  });

  it("notifications@github.com without list headers is a notification", () => {
    expect(classify({ From: "GitHub <notifications@github.com>", Subject: "[repo] PR merged" })).toBe("notification");
    expect(classify({ From: "Alerts <no-reply@example.com>", Subject: "Hi" })).toBe("notification");
  });

  it("a domain from the list, or its subdomain, counts as automated", () => {
    expect(classify({ From: "Linear <team@linear.app>", Subject: "Assigned" })).toBe("notification");
    expect(classify({ From: "x@mail.datadoghq.com", Subject: "Monitor" })).toBe("notification");
    expect(classify({ From: "bot@myshop.com", Subject: "Hi" }, [...DEFAULT_AUTOMATED_DOMAINS, "myshop.com"])).toBe(
      "notification",
    );
  });

  it("a full address in the list matches only that sender", () => {
    const domains = [...DEFAULT_AUTOMATED_DOMAINS, "beto@gmail.com"];
    expect(classify({ From: "Beto <Beto@gmail.com>", Subject: "Cadena" }, domains)).toBe("notification");
    expect(classify({ From: "Ana <ana@gmail.com>", Subject: "Hola" }, domains)).toBe("person");
  });

  it("a real name from gmail.com is a person", () => {
    expect(classify({ From: "Ana Pérez <ana.perez@gmail.com>", Subject: "¿Almorzamos?" })).toBe("person");
    expect(
      classify({ From: "Ana Pérez <ana.perez@gmail.com>", Subject: "Hola" }, DEFAULT_AUTOMATED_DOMAINS, [
        "CATEGORY_PERSONAL",
      ]),
    ).toBe("person");
  });

  it("marketing without list headers is a newsletter when Gmail files it under Promotions", () => {
    const bank = { From: "Banco <marketing@banco.com.uy>", Subject: "Este ciberlunes, aprovecha" };
    expect(classify(bank, DEFAULT_AUTOMATED_DOMAINS, ["UNREAD", "CATEGORY_PROMOTIONS"])).toBe("newsletter");
  });

  it("Gmail's Updates, Social and Forums tabs are notifications, never a person", () => {
    const alert = { From: "Banco <comunicaciones@banco.com.uy>", Subject: "Aviso de consumo aprobado" };
    for (const label of ["CATEGORY_UPDATES", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"]) {
      expect(classify(alert, DEFAULT_AUTOMATED_DOMAINS, [label])).toBe("notification");
    }
  });

  it("an invoice filed under Updates is still an invoice", () => {
    expect(
      classify({ From: "UTE <facturas@ute.com.uy>", Subject: "Tu factura" }, DEFAULT_AUTOMATED_DOMAINS, [
        "CATEGORY_UPDATES",
      ]),
    ).toBe("invoice");
  });
});

describe("automatedEntryFor", () => {
  it("writes the domain for a company and the address on free providers, regional ones included", () => {
    expect(automatedEntryFor("promo@wagnerfood.com")).toBe("wagnerfood.com");
    expect(automatedEntryFor("beto@gmail.com")).toBe("beto@gmail.com");
    expect(automatedEntryFor("tia@hotmail.es")).toBe("tia@hotmail.es");
    expect(automatedEntryFor("vecino@adinet.com.uy")).toBe("vecino@adinet.com.uy");
  });

  it("refuses anything that is not one plain address", () => {
    expect(automatedEntryFor("undisclosed-recipients:;")).toBeNull();
    expect(automatedEntryFor("a@b.com>, c@d.com")).toBeNull();
  });
});

describe("parseFrom", () => {
  it("reads name and address in both forms", () => {
    expect(parseFrom('"Ana Pérez" <ana@gmail.com>')).toEqual({ name: "Ana Pérez", address: "ana@gmail.com" });
    expect(parseFrom("ana@gmail.com")).toEqual({ name: "ana", address: "ana@gmail.com" });
  });
});
