import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChecklistWhatsAppMessage, canSendChecklist, checklistWhatsAppUrl, isDialable,
} from "./checklistShare.ts";

test("only Owner and Manager can send, only when switched on and signed off", () => {
  const ok = { role: "Owner", sendEnabled: true, signedOff: true };
  assert.equal(canSendChecklist(ok), true);
  assert.equal(canSendChecklist({ ...ok, role: "Manager" }), true);
  for (const role of ["Technician", "Cashier", "Receptionist", undefined]) assert.equal(canSendChecklist({ ...ok, role }), false);
  assert.equal(canSendChecklist({ ...ok, sendEnabled: false }), false);
  assert.equal(canSendChecklist({ ...ok, signedOff: false }), false);
});

test("the message names the customer, vehicle and workshop when known, and always carries the link", () => {
  const full = buildChecklistWhatsAppMessage({ customerName: " Kamal ", plate: "CAI 5598", centerName: "Halford Care", link: "https://x/y", centerPhone: "+94 762 36 36 37" });
  assert.equal(full, "Dear Kamal, your post-service checklist report for CAI 5598 from Halford Care is ready. View & download: https://x/y — +94 762 36 36 37");
  const bare = buildChecklistWhatsAppMessage({ link: "https://x/y" });
  assert.equal(bare, "Your post-service checklist report is ready. View & download: https://x/y");
});

test("a Sri Lankan number opens that chat; anything else falls back to WhatsApp's contact picker", () => {
  const msg = "hi & bye";
  assert.equal(checklistWhatsAppUrl("0771234567", msg), `https://wa.me/94771234567?text=${encodeURIComponent(msg)}`);
  assert.equal(checklistWhatsAppUrl("+94 77 123 4567", msg), `https://wa.me/94771234567?text=${encodeURIComponent(msg)}`);
  assert.equal(checklistWhatsAppUrl("", msg), `https://wa.me/?text=${encodeURIComponent(msg)}`);
  assert.equal(checklistWhatsAppUrl("123", msg), `https://wa.me/?text=${encodeURIComponent(msg)}`);
  assert.equal(isDialable("0771234567"), true);
  assert.equal(isDialable("abc"), false);
});
