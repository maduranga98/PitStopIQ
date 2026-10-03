// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicReportUrl, shortCodeForToken, smsShortLink, whatsAppNumber, buildWhatsAppMessage, whatsAppUrl, buildSmsMessage,
} from "./shareText.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

test("links", () => {
  assert.equal(publicReportUrl(TOKEN), `https://app.pitstopiq.com/i/${TOKEN}`);
  assert.equal(shortCodeForToken(TOKEN), "AbCdEfG");
  assert.equal(smsShortLink(TOKEN), "app.pitstopiq.com/v/AbCdEfG");
});

test("WhatsApp number: every stored/typed form becomes country-code digits", () => {
  for (const raw of ["+94771234567", "0771234567", "94771234567", "077 123 4567", "0094771234567"]) {
    assert.equal(whatsAppNumber(raw), "94771234567", raw);
  }
});

test("WhatsApp message and url", () => {
  const msg = buildWhatsAppMessage({ customerName: "Kamal", reportNumber: "INS-2026-0007", plate: "CAB-1234", link: publicReportUrl(TOKEN), centerPhone: "011 234 5678" });
  assert.match(msg, /^Dear Kamal, your vehicle inspection report INS-2026-0007 for CAB-1234 is ready\. View & download: https:\/\/app\.pitstopiq\.com\/i\//);
  assert.ok(msg.endsWith("— 011 234 5678"));
  assert.ok(!buildWhatsAppMessage({ customerName: "K", reportNumber: "X", plate: "P", link: "l" }).includes("—"));
  const url = whatsAppUrl("+94771234567", msg);
  assert.ok(url.startsWith("https://wa.me/94771234567?text="));
  assert.equal(decodeURIComponent(url.split("text=")[1]), msg);
});

test("SMS message uses the scheme-less short link and stays ASCII", () => {
  const m = buildSmsMessage({ customerName: "Kamal", reportNumber: "INS-2026-0007", centerName: "Silva Auto Care", shareToken: TOKEN });
  assert.equal(m, "Dear Kamal, your vehicle inspection report INS-2026-0007 from Silva Auto Care is ready: app.pitstopiq.com/v/AbCdEfG");
  assert.ok(!/[^\x20-\x7e]/.test(m));
  assert.ok(!m.includes("https://"));
});
