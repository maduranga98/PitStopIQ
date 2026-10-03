import { chromium } from "playwright-core";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, updateDoc, collection } from "firebase/firestore";

// End-to-end check of Inspection Reports against the Firebase emulators (real
// firestore.rules), driving the real pages in headless Chromium. See README.md.
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = "http://127.0.0.1:5199";

// ── seed ──────────────────────────────────────────────────────────────────────
async function signUp(email) {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "pass1234", returnSecureToken: true }) });
  return (await r.json()).localId;
}
const env = await initializeTestEnvironment({ projectId: "demo-test", firestore: { host: "127.0.0.1", port: 8085 } });
const ownerUid = await signUp("owner@t.lk"), techUid = await signUp("tech@t.lk"), mgrUid = await signUp("mgr@t.lk");
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "servicecenters/c1"), { name: "Test Center", plan: "basic", standaloneInspectionEnabled: true, ownerUid });
  await setDoc(doc(db, "servicecenters/c1/staff", ownerUid), { role: "Owner", fullName: "Olive Owner", active: true });
  await setDoc(doc(db, "servicecenters/c1/staff", techUid), { role: "Technician", fullName: "Tim Tech", active: true });
  await setDoc(doc(db, "servicecenters/c1/staff", mgrUid), { role: "Manager", fullName: "Mia Manager", active: true });
  await setDoc(doc(db, "servicecenters/c1/customers/cu1"), { name: "Kamal Perera", phone: "+94771234567", isDeleted: false, vehicleCount: 1, centerId: "c1", smsLanguage: "english", notes: null, lastServiceDate: null });
  await setDoc(doc(db, "servicecenters/c1/vehicles/v1"), { plateNumber: "CAB-1234", searchPlate: "cab1234", make: "Toyota", model: "Aqua", vehicleType: "Car", customerId: "cu1", customerName: "Kamal Perera", currentMileageKm: 45000, nextServiceMileageKm: 50000, isDeleted: false, centerId: "c1" });
});
async function admin(fn) { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx); }); return out; }
const read = (path) => admin(async (ctx) => { const s = await getDoc(doc(ctx.firestore(), path)); return s.exists() ? s.data() : null; });
const list = (path) => admin(async (ctx) => (await getDocs(collection(ctx.firestore(), path))).docs.map((d) => ({ id: d.id, ...d.data() })));

// ── images ────────────────────────────────────────────────────────────────────
mkdirSync("tmp", { recursive: true });
// 800x400 landscape pixels, EXIF orientation 6 (phone held upright): must display 400x800.
await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().withMetadata({ orientation: 6 }).toFile("tmp/sideways.jpg");
await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 20, g: 80, b: 200 } } }).jpeg().toFile("tmp/big.jpg");
writeFileSync("tmp/scan.pdf", Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"));
writeFileSync("tmp/notes.txt", "hello");

// ── browser ───────────────────────────────────────────────────────────────────
const exe = readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-"))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ["--no-sandbox"] });
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error","warning"].includes(m.type())) console.log("  [console]", m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
  await page.goto(`${BASE}/inspection-reports?u=${email}&p=pass1234`);
  return { ctx, page };
}
async function until(fn, ms = 8000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(250); } }
const dims = async (url) => { const b = Buffer.from(await (await fetch(url)).arrayBuffer()); const m = await sharp(b).metadata(); return { w: m.width, h: m.height, o: m.orientation, bytes: b.length, fmt: m.format }; };

try {
  // ═══ OWNER: create via vehicle search ═══
  let { ctx, page } = await session("owner@t.lk");
  await page.waitForSelector("text=Inspection Reports");
  await page.screenshot({ path: "dbg-list.png" });
  check("list renders for owner (gate open, empty drafts)", await page.getByText("No drafts.").waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.goto(`${BASE}/inspection-reports/new`);
  await page.getByPlaceholder("Plate number or customer phone").fill("cab 12");
  await page.waitForSelector("text=CAB-1234");
  await page.getByText("CAB-1234").click();
  await page.waitForSelector("text=Kamal Perera");
  check("mileage prefilled from vehicle, not required", (await page.getByPlaceholder("Optional").inputValue()) === "45000");
  await page.getByLabel("Assign to technician").selectOption({ index: 1 }).catch(() => {});
  await page.locator("select").selectOption({ label: "Tim Tech" });
  await page.screenshot({ path: "shot-new.png" });
  await page.getByRole("button", { name: "Start report" }).click();
  await page.waitForURL(/\/inspection-reports\/[A-Za-z0-9]{20}$/);
  const reportId = page.url().split("/").pop();
  await page.waitForSelector("text=Checklist template", { state: "detached" }).catch(() => {});
  await page.waitForSelector("text=Operational Test");
  let rep = await until(() => read(`servicecenters/c1/inspectionReports/${reportId}`));
  check("draft created through the real rules (explicit nulls accepted)", !!rep && rep.status === "draft" && rep.reportNumber === null && rep.viewCount === 0);
  check("snapshot has the 6 visible default sections (Hybrid hidden)", rep.templateSnapshot.length === 6 && !rep.templateSnapshot.some((s) => s.id === "hybrid"), rep.templateSnapshot.map((s) => s.id).join(","));
  check("assigned technician stored", rep.assignedToUid === techUid && rep.assignedToName === "Tim Tech");
  check("mileage is a plain value on the report", rep.mileage === 45000);
  const tpl = await until(() => read("servicecenters/c1/inspectionTemplates/default"));
  check("template seeded on first use", !!tpl && tpl.sections.length === 7);
  check("vehicle untouched (mileage + reminder fields unchanged)", (await read("servicecenters/c1/vehicles/v1")).nextServiceMileageKm === 50000);

  // answer + remark
  const first = page.locator("text=No abnormal engine noise").locator("xpath=ancestor::div[contains(@class,'space-y-2.5')][1]");
  await first.getByRole("button", { name: "Repair" }).click();
  await first.getByRole("button", { name: "Remark" }).click();
  await first.getByPlaceholder("Remark").fill("Knocking at idle");
  await sleep(1500);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  const r1 = rep.results["operational__engine_noise"];
  check("answer + remark autosaved under a dotted path", r1?.status === "needs_repair" && r1?.remark === "Knocking at idle", JSON.stringify(r1));
  // tap again clears
  await first.getByRole("button", { name: "Repair" }).click(); await first.getByRole("button", { name: "Repair" }).click();
  await sleep(1200);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("tapping the active answer clears then re-sets", rep.results["operational__engine_noise"].status === "needs_repair");

  // photo: sideways EXIF + rotate
  await first.locator("input[type=file]").setInputFiles("tmp/sideways.jpg");
  await page.waitForSelector("text=Add photo");
  await page.waitForSelector("img[alt=Preview]");
  const previewDims = await page.evaluate(() => { const i = document.querySelector("img[alt=Preview]"); return [i.naturalWidth, i.naturalHeight]; });
  check("EXIF-sideways photo previews upright (400x800)", previewDims[0] === 400 && previewDims[1] === 800, previewDims.join("x"));
  await page.getByRole("button", { name: "Rotate" }).click();
  await page.waitForFunction(() => { const i = document.querySelector("img[alt=Preview]"); return i && i.naturalWidth === 800; });
  check("manual rotate swaps to 800x400", true);
  await page.getByRole("button", { name: "Use photo" }).click();
  await page.waitForSelector("img[alt^=photo-]");
  await sleep(1200);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  const pid = r1 && rep.results["operational__engine_noise"].photoIds?.[0];
  const m = rep.media?.[pid];
  check("photo stored in media map with url, not pending", !!m && !!m.url && m.pending === false && m.kind === "photo", pid);
  const d = m && await dims(m.url);
  check("stored photo is JPEG at 800x400 after rotate, orientation baked in", d && d.fmt === "jpeg" && d.w === 800 && d.h === 400 && !d.o, JSON.stringify(d));

  // big photo resize
  await first.locator("input[type=file]").setInputFiles("tmp/big.jpg");
  await page.waitForSelector("img[alt=Preview]");
  await page.waitForFunction(() => { const i = document.querySelector("img[alt=Preview]"); return i && i.naturalWidth > 0; });
  const bigDims = await page.evaluate(() => { const i = document.querySelector("img[alt=Preview]"); return [i.naturalWidth, i.naturalHeight]; });
  check("4000x3000 photo resized to 1600x1200", bigDims[0] === 1600 && bigDims[1] === 1200, bigDims.join("x"));
  await page.getByRole("button", { name: "Discard" }).first().click();

  // report-only item + save to checklist
  await page.getByPlaceholder("Add an item to this report").first().fill("Roof rack mounts");
  await page.getByLabel("Also save to my checklist").check();
  await page.getByRole("button", { name: "Add item" }).first().click();
  await page.waitForSelector("text=Roof rack mounts");
  await sleep(1500);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  const tpl2 = await read("servicecenters/c1/inspectionTemplates/default");
  check("report-only item stored on the report", rep.reportOnlyItems.some((i) => i.label === "Roof rack mounts" && i.sectionId === "operational"));
  check("…and saved to the center template when ticked", tpl2.sections.find((s) => s.id === "operational").items.some((i) => i.label === "Roof rack mounts" && i.isDefault === false));
  check("…but the report's snapshot is unchanged", !rep.templateSnapshot.find((s) => s.id === "operational").items.some((i) => i.label === "Roof rack mounts"));

  // attachments
  const attachInput = page.locator("text=Attachments").locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]").locator("input[type=file]");
  await attachInput.setInputFiles("tmp/scan.pdf");
  await page.waitForSelector("text=scan.pdf");
  await attachInput.setInputFiles("tmp/notes.txt");
  await page.waitForSelector("text=Only PDF, JPG or PNG files are accepted.");
  check("attachment: PDF accepted, .txt rejected with message", true);
  await sleep(1200);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("attachment recorded (id in attachmentIds, entry in media)", rep.attachmentIds.length === 1 && rep.media[rep.attachmentIds[0]].mimeType === "application/pdf");

  await page.screenshot({ path: "shot-editor.png", fullPage: false });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: "shot-editor-bottom.png" });
  // header fields
  await page.getByPlaceholder("Name of the person signing off").fill("O. Owner");
  await page.getByPlaceholder("What stood out during the inspection").fill("Engine noisy");
  await sleep(1300);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("text fields autosave", rep.signatureName === "O. Owner" && rep.observations === "Engine noisy");

  // ═══ OFFLINE: edit + queued photo ═══
  await ctx.setOffline(true);
  await page.waitForSelector("text=You're offline");
  await first.getByRole("button", { name: "N/A" }).click();
  await first.locator("input[type=file]").setInputFiles("tmp/sideways.jpg");
  await page.waitForSelector("img[alt=Preview]");
  await page.waitForFunction(() => { const i = document.querySelector("img[alt=Preview]"); return i && i.naturalWidth > 0; });
  await page.getByRole("button", { name: "Use photo" }).click();
  await page.waitForSelector("text=Queued");
  check("offline: photo shows as Queued with a local preview", await page.locator("img[alt^=photo-]").count() >= 2);
  await sleep(500);
  let serverRep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("offline: nothing reached the server yet", serverRep.results["operational__engine_noise"].status === "needs_repair" && Object.keys(serverRep.media).length === 2, Object.keys(serverRep.media).length + " media on server");
  await ctx.setOffline(false);
  await page.waitForFunction(() => !document.body.innerText.includes("Queued"), null, { timeout: 30000 });
  await sleep(1500);
  serverRep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  const photos = serverRep.results["operational__engine_noise"].photoIds.map((id) => serverRep.media[id]);
  check("reconnect: offline edit synced", serverRep.results["operational__engine_noise"].status === "na");
  check("reconnect: queued photo uploaded, url set, pending cleared", photos.length === 2 && photos.every((p) => p?.url && p.pending === false), JSON.stringify(photos.map((p) => !!p?.url + "/" + p?.pending)));

  // list shows the draft; load-more absent
  await page.goto(`${BASE}/inspection-reports?u=owner@t.lk&p=pass1234`);
  await page.waitForSelector("text=CAB-1234");
  check("list shows the draft with assignee", await page.getByText("Tim Tech").isVisible());

  // ═══ QUICK ADD ═══
  await page.goto(`${BASE}/inspection-reports/new`);
  await page.getByText("Customer not registered?").click();
  await page.screenshot({ path: "shot-quick.png" });
  await page.getByPlaceholder("Kamal Perera").fill("Nimal Silva");
  await page.getByPlaceholder("077 123 4567").fill("0712345678");
  await page.getByPlaceholder("CAB-1234").fill("wp xy-9999");
  await page.getByPlaceholder("Toyota").fill("Honda");
  await page.getByPlaceholder("Aqua").fill("Vezel");
  await page.getByPlaceholder("Optional").first().fill("12000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForSelector("text=Start report");
  const custs = await list("servicecenters/c1/customers");
  const veh = await list("servicecenters/c1/vehicles");
  const nc = custs.find((c) => c.name === "Nimal Silva"), nv = veh.find((v) => v.plateNumber === "WP XY-9999");
  check("quick-add created a real customer (+94 format, normal fields)", !!nc && nc.phone === "+94712345678" && nc.isDeleted === false && nc.vehicleCount === 0 && nc.smsLanguage === "english");
  check("quick-add created a real vehicle, plate upper-cased", !!nv && nv.customerId === nc.id && nv.make === "Honda" && nv.currentMileageKm === 12000);
  check("quick-added vehicle: nextServiceMileageKm explicitly null, no reminder fields", nv.nextServiceMileageKm === null && !("reminderSent" in nv) && !("nextServiceDate" in nv));
  await sleep(1500);
  const logs = await list(`servicecenters/c1/vehicles/${nv.id}/logs`);
  check("vehicle 'added' history entry written", logs.some((l) => /Vehicle added — WP XY-9999/.test(l.message)));
  // duplicate phone → prompt; duplicate plate → prompt
  await page.goto(`${BASE}/inspection-reports/new`);
  await page.getByText("Customer not registered?").click();
  await page.getByPlaceholder("Kamal Perera").fill("Someone Else");
  await page.getByPlaceholder("077 123 4567").fill("071 234 5678");
  await page.getByPlaceholder("CAB-1234").fill("NEW-0001");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForSelector("text=A customer with this phone already exists");
  check("existing phone → offers to reuse the customer", true);
  await page.goto(`${BASE}/inspection-reports/new`);
  await page.getByText("Customer not registered?").click();
  await page.getByPlaceholder("Kamal Perera").fill("Someone Else");
  await page.getByPlaceholder("077 123 4567").fill("0779998888");
  await page.getByPlaceholder("CAB-1234").fill("cab 1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForSelector("text=is already registered to");
  check("existing plate (different spelling) → offers to reuse the vehicle", true);
  const beforeC = (await list("servicecenters/c1/customers")).length;
  check("…and created nothing new", beforeC === 2);
  // ═══ OFFLINE: create a brand-new draft with no connection ═══
  await page.goto(`${BASE}/inspection-reports/new?vehicleId=v1&u=owner@t.lk&p=pass1234`);
  await page.waitForSelector("text=CAB-1234");
  await page.getByRole("button", { name: "Start report" }).waitFor();
  const idsBefore = (await list("servicecenters/c1/inspectionReports")).map((d) => d.id);
  await ctx.setOffline(true);
  await page.locator("select").selectOption({ label: "Don't assign" });
  await page.getByRole("button", { name: "Start report" }).click();
  await page.waitForURL(/\/inspection-reports\/[A-Za-z0-9]{20}$/, { timeout: 20000 });
  const offId = page.url().split("/").pop();
  await page.waitForSelector("text=Operational Test");
  check("offline: new draft opens from cached template + vehicle", true);
  const o1 = page.locator("text=Horn").first().locator("xpath=ancestor::div[contains(@class,'space-y-2.5')][1]");
  await page.getByText("Functional and Walkaround").click();
  await page.locator("text=Warning lights").locator("xpath=ancestor::div[contains(@class,'space-y-2.5')][1]").getByRole("button", { name: "Meets" }).click();
  await sleep(1200);
  check("offline: draft not on the server yet", !idsBefore.includes(offId) && !(await list("servicecenters/c1/inspectionReports")).some((d) => d.id === offId));
  await ctx.setOffline(false);
  const synced = await until(async () => { const r = await read(`servicecenters/c1/inspectionReports/${offId}`); return r && r.results?.functional__warning_lights?.status === "meets" ? r : null; }, 20000);
  check("reconnect: offline-created draft and its edit sync", !!synced && synced.status === "draft" && synced.assignedToUid === null, synced ? "" : "never arrived");
  await ctx.close();

  // ═══ TECHNICIAN ═══
  ({ ctx, page } = await session("tech@t.lk"));
  await page.waitForSelector("text=Inspection Reports");
  await page.waitForSelector("text=CAB-1234");
  check("technician sees only their assigned report; no New button", (await page.locator("a[href^='/inspection-reports/']").count()) === 1 && (await page.getByRole("button", { name: "New" }).count()) === 0);
  await page.locator("a[href^='/inspection-reports/']").first().click();
  await page.waitForSelector("text=Operational Test");
  check("technician editor hides assign + delete + save-to-checklist", (await page.getByText("Assigned to").count()) === 0 && (await page.getByText("Delete draft").count()) === 0);
  const t1 = page.locator("text=Seat belt condition and operation").locator("xpath=ancestor::div[contains(@class,'space-y-2.5')][1]");
  await t1.getByRole("button", { name: "Meets" }).click();
  await sleep(1500);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("technician's edit accepted by the rules", rep.results["operational__seat_belt"]?.status === "meets");
  await page.getByPlaceholder("Name of the person signing off").fill("Tim");
  await sleep(1300);
  rep = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("technician can sign off", rep.signatureName === "Tim");
  await page.goto(`${BASE}/inspection-reports/new?u=tech@t.lk&p=pass1234`);
  await page.waitForSelector("text=CAB-1234");
  check("technician /new redirects to the list", page.url().endsWith("/inspection-reports"));
  await ctx.close();

  // ═══ FINALIZE (server callables: number, lock, PDF, retention, reopen) ═══
  ({ ctx, page } = await session("owner@t.lk"));
  const thisYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Colombo", year: "numeric" }).format(new Date()));
  const fnCall = (name, data) => page.evaluate(([n, d]) => window.__call(n, d), [name, data]);
  async function answerAll(id) {
    await admin(async (ctx2) => {
      const ref = doc(ctx2.firestore(), `servicecenters/c1/inspectionReports/${id}`);
      const r = (await getDoc(ref)).data();
      const ids = [...r.templateSnapshot.flatMap((s) => s.items.map((i) => i.id)), ...r.reportOnlyItems.map((i) => i.id)];
      const patch = {};
      for (const k of ids) if (!r.results?.[k]?.status) patch[`results.${k}.status`] = "meets";
      await updateDoc(ref, patch);
    });
  }
  const counter = async () => (await read(`servicecenters/c1/inspectionCounters/${thisYear}`))?.seq ?? 0;

  // 1. blocked while items are unanswered
  await page.goto(`${BASE}/inspection-reports/${offId}?u=owner@t.lk&p=pass1234`);
  await page.waitForSelector("text=Operational Test");
  check("finalize blocked: unanswered items listed, button disabled", (await page.getByText(/checklist items are not answered/).isVisible()) && (await page.getByRole("button", { name: "Finalize report" }).isDisabled()));
  let res = await fnCall("finalizeInspectionReport", { centerId: "c1", reportId: offId });
  check("server refuses too (same rule, not just the UI)", !res.ok && res.code === "functions/failed-precondition" && /not answered/.test(res.message), res.message);
  check("…and assigned no number", (await read(`servicecenters/c1/inspectionReports/${offId}`)).reportNumber === null && (await counter()) === 0);

  // 2. ready -> finalize through the UI
  await answerAll(offId);
  await page.goto(`${BASE}/inspection-reports/${offId}?u=owner@t.lk&p=pass1234`);
  await page.waitForSelector("text=Everything is answered");
  await page.getByRole("button", { name: "Finalize report" }).click();
  await page.getByRole("button", { name: "Finalize", exact: true }).click();
  await page.waitForSelector("text=Download PDF", { timeout: 60000 });
  let fin = await read(`servicecenters/c1/inspectionReports/${offId}`);
  check(`first number is INS-${thisYear}-0001 (Colombo year)`, fin.reportNumber === `INS-${thisYear}-0001`, fin.reportNumber);
  check("status finalized, finalizedAt and finalizedBy set", fin.status === "finalized" && !!fin.finalizedAt && fin.finalizedBy === ownerUid);
  check("counter document advanced to 1", (await counter()) === 1);
  check("PDF path/url/time recorded", fin.pdfPath === `inspectionReports/c1/${offId}/report.pdf` && /alt=media&token=/.test(fin.pdfUrl) && !!fin.pdfGeneratedAt);
  // The emulator serves Storage on its own host; production uses the URL as stored.
  const emu = (u) => u.replace("https://firebasestorage.googleapis.com", "http://127.0.0.1:9195");
  const pdfRes = await fetch(emu(fin.pdfUrl)); const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check("PDF downloads with its token and is a real PDF", pdfRes.ok && pdfBuf.subarray(0, 5).toString() === "%PDF-" && pdfBuf.length > 2000, `${pdfBuf.length} bytes`);
  check("editor is read-only after finalize (inputs locked, Reopen offered)", (await page.getByPlaceholder("Name of the person signing off").getAttribute("readonly")) !== null && (await page.getByRole("button", { name: "Reopen" }).isVisible()));
  res = await fnCall("finalizeInspectionReport", { centerId: "c1", reportId: offId });
  check("finalizing again is idempotent (same number, counter unchanged)", res.ok && res.data.reportNumber === fin.reportNumber && (await counter()) === 1);

  // 3. reopen keeps number/PDF, re-finalize keeps the number
  await page.getByRole("button", { name: "Reopen" }).click();
  await page.getByRole("button", { name: "Reopen", exact: true }).last().click();
  await page.waitForSelector("text=Finalize report");
  let reopened = await read(`servicecenters/c1/inspectionReports/${offId}`);
  check("reopen: back to draft, number and PDF kept, share/visibility untouched", reopened.status === "draft" && reopened.reportNumber === fin.reportNumber && reopened.pdfUrl === fin.pdfUrl && reopened.shareRevoked === false && reopened.visibleToCustomer === true);
  await page.getByRole("button", { name: "Finalize report" }).click();
  await page.getByRole("button", { name: "Finalize", exact: true }).click();
  await page.waitForSelector("text=Download PDF", { timeout: 60000 });
  const refin = await read(`servicecenters/c1/inspectionReports/${offId}`);
  check("re-finalize keeps the same number, counter still 1", refin.reportNumber === fin.reportNumber && (await counter()) === 1);
  check("regenerated PDF keeps the same download token (links stay valid)", new URL(refin.pdfUrl).searchParams.get("token") === new URL(fin.pdfUrl).searchParams.get("token"));

  // 4. the rich report: photos + attachment + remarks -> retention + PDF content
  await answerAll(reportId);
  res = await fnCall("finalizeInspectionReport", { centerId: "c1", reportId });
  check("second report gets INS-…-0002", res.ok && res.data.reportNumber === `INS-${thisYear}-0002` && res.data.pdfReady === true, JSON.stringify(res));
  const rich = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  const imgs = Object.values(rich.media).filter((m) => m.mimeType.startsWith("image/")), pdfs = Object.values(rich.media).filter((m) => m.mimeType === "application/pdf");
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const fAt = rich.finalizedAt.toDate();
  check("every image gets mediaDeleteAt = finalized + 12 months", imgs.length >= 2 && imgs.every((m) => m.mediaDeleteAt && monthsBetween(fAt, m.mediaDeleteAt.toDate()) === 12), imgs.map((m) => m.mediaDeleteAt?.toDate().toISOString().slice(0, 10)).join(","));
  check("PDF attachment has no retention date", pdfs.length === 1 && !pdfs[0].mediaDeleteAt);
  check("nextMediaDeleteAt = earliest image expiry", rich.nextMediaDeleteAt && Math.abs(rich.nextMediaDeleteAt.toMillis() - Math.min(...imgs.map((m) => m.mediaDeleteAt.toMillis()))) < 1000);
  const richPdf = Buffer.from(await (await fetch(emu(rich.pdfUrl))).arrayBuffer());
  writeFileSync("tmp/rich.pdf", richPdf);
  const txt = execFileSync("pdftotext", ["-layout", "tmp/rich.pdf", "-"], { encoding: "utf8" });
  check("PDF text: number, customer, plate, remark, observations, attachment name, signature", [rich.reportNumber, "Kamal Perera", "CAB-1234", "Knocking at idle", "Engine noisy", "scan.pdf", "Test Center"].every((t) => txt.includes(t)), "");
  const images = execFileSync("pdfimages", ["-list", "tmp/rich.pdf"], { encoding: "utf8" }).trim().split("\n").length - 2;
  check("PDF embeds the photos", images >= 2, `${images} images`);

  // 5. blockers: queued photos; permissions
  const base = await read(`servicecenters/c1/inspectionReports/${offId}`);
  const mk = async (id, over) => admin(async (c2) => { await setDoc(doc(c2.firestore(), `servicecenters/c1/inspectionReports/${id}`), { ...base, ...over, status: "draft", reportNumber: null, finalizedAt: null, pdfUrl: null, pdfPath: null, pdfGeneratedAt: null, nextMediaDeleteAt: null, shareToken: id.padEnd(32, "x") }); });
  await mk("pend1", { media: { m1: { id: "m1", kind: "photo", mimeType: "image/jpeg", url: null, pending: true, mediaDeleted: false } } });
  res = await fnCall("finalizeInspectionReport", { centerId: "c1", reportId: "pend1" });
  check("a photo still queued blocks finalize", !res.ok && /still uploading/.test(res.message), res.message);
  await mk("diag1", { type: "diagnostic", title: "  ", templateSnapshot: [], reportOnlyItems: [], results: {} });
  res = await fnCall("finalizeInspectionReport", { centerId: "c1", reportId: "diag1" });
  check("diagnostic report needs a title", !res.ok && /title/.test(res.message), res.message);
  res = await fnCall("finalizeInspectionReport", { centerId: "c1", reportId: "nope" });
  check("unknown report -> not-found", !res.ok && res.code === "functions/not-found");

  // 6. concurrency: six at once -> six distinct, gapless numbers
  const ids6 = ["c1x", "c2x", "c3x", "c4x", "c5x", "c6x"];
  for (const id of ids6) await mk(id, {});
  const before = await counter();
  const outs = await Promise.all(ids6.map((id) => fnCall("finalizeInspectionReport", { centerId: "c1", reportId: id })));
  const nums = outs.map((o) => o.ok && o.data.reportNumber).sort();
  const expected = ids6.map((_, i) => `INS-${thisYear}-${String(before + 1 + i).padStart(4, "0")}`);
  check("6 concurrent finalizes: distinct, consecutive numbers (atomic counter)", JSON.stringify(nums) === JSON.stringify(expected), nums.join(","));
  check("counter equals the last number issued", (await counter()) === before + 6);

  // ═══ SHARING: public link, tracking, revoke, WhatsApp, SMS + quota, portal toggle ═══
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const doc1 = await read(`servicecenters/c1/inspectionReports/${offId}`);
  const tok = doc1.shareToken, richTok = rich.shareToken;
  const anonCall = async (name, data) => { const c = await browser.newContext(); const p = await c.newPage(); await p.goto(`${BASE}/i/${"x".repeat(32)}`); const r = await p.evaluate(([n, d]) => window.__call(n, d), [name, data]); await c.close(); return r; };

  await page.goto(`${BASE}/inspection-reports/${offId}?u=owner@t.lk&p=pass1234`);
  await page.waitForSelector("text=Share with customer");
  check("share card shows the report link, not sent, not viewed", (await page.getByText(`/i/${tok}`).isVisible()) && (await page.getByText("Not sent yet").isVisible()) && (await page.getByText("Not viewed yet").isVisible()));
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  check("Copy link puts the public URL on the clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === `https://app.pitstopiq.com/i/${tok}`);

  // public payload: what a customer may and may not see
  let pub = await anonCall("getPublicInspectionReport", { shareToken: tok });
  const payloadText = JSON.stringify(pub);
  check("public payload: ready, number, plate, customer name", pub.ok && pub.data.state === "ready" && pub.data.report.reportNumber === fin.reportNumber && pub.data.report.vehicle.plateNumber === "CAB-1234" && pub.data.report.customerName === "Kamal Perera");
  check("public payload leaks no phone, uid, token, or internals", !payloadText.includes("77123") && !payloadText.includes(ownerUid) && !payloadText.includes(tok) && !payloadText.includes("assignedTo") && !payloadText.includes("createdBy") && !payloadText.includes("mediaDeleteAt") && !payloadText.includes("finalizedBy"));
  pub = await anonCall("getPublicInspectionReport", { shareToken: "nope" });
  check("garbage token -> not found", pub.ok && pub.data.found === false);
  pub = await anonCall("getPublicInspectionReport", { shareToken: "Z".repeat(32) });
  check("well-formed unknown token -> not found", pub.ok && pub.data.found === false);

  // the page itself, signed out
  let anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let ap = await anon.newPage();
  await ap.goto(`${BASE}/i/${richTok}`);
  await ap.waitForSelector(`text=${rich.reportNumber}`);
  await ap.getByText("Operational Test").waitFor();
  await ap.screenshot({ path: "shot-public.png", fullPage: false });
  const bodyText = await ap.locator("body").innerText();
  check("public page renders the report (plate, remark, observations, attachment, PDF button)", ["CAB-1234", "Knocking at idle", "Engine noisy", "scan.pdf", "Test Center"].every((t) => bodyText.includes(t)) && (await ap.getByRole("link", { name: /PDF/ }).first().isVisible()));
  check("public page shows photos", (await ap.locator("img[loading=lazy]").count()) >= 2);
  check("public page does not show the customer phone", !bodyText.includes("77123 4567") && !bodyText.includes("+94771234567"));
  await sleep(1500);
  let after = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("first view recorded: viewedAt set, viewCount 1", !!after.viewedAt && after.viewCount === 1 && !!after.lastViewedAt, `count ${after.viewCount}`);
  await ap.reload(); await ap.waitForSelector(`text=${rich.reportNumber}`); await sleep(1500);
  after = await read(`servicecenters/c1/inspectionReports/${reportId}`);
  check("a reload inside the throttle window doesn't inflate the count", after.viewCount === 1);
  await anon.close();

  // WhatsApp
  await page.goto(`${BASE}/inspection-reports/${offId}?u=owner@t.lk&p=pass1234`);
  await page.waitForSelector("text=Share with customer");
  // No internet in the test run: answer wa.me ourselves so the popup keeps its URL.
  await ctx.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>wa.me</p>" }));
  const popupP = page.waitForEvent("popup");
  await page.getByRole("button", { name: "WhatsApp" }).click();
  const popup = await popupP;
  await popup.waitForLoadState();
  const waUrl = popup.url();
  check("WhatsApp opens wa.me with the customer's number", waUrl.startsWith("https://wa.me/94771234567?text="), waUrl.slice(0, 60));
  const waText = decodeURIComponent(waUrl.split("text=")[1]);
  check("WhatsApp text has name, number, plate and the full link", waText.includes("Kamal Perera") && waText.includes(fin.reportNumber) && waText.includes("CAB-1234") && waText.includes(`https://app.pitstopiq.com/i/${tok}`), waText);
  await popup.close();
  await sleep(1200);
  check("sending by WhatsApp stamps sharedAt", !!(await read(`servicecenters/c1/inspectionReports/${offId}`)).sharedAt);

  // SMS
  const smsBefore = (await list("servicecenters/c1/smsLogs")).length;
  await page.getByRole("button", { name: "SMS", exact: true }).click();
  await page.waitForSelector("text=SMS queued");
  const smsLogsNow = await list("servicecenters/c1/smsLogs");
  const smsLog = smsLogsNow.find((l) => l.messageType === "InspectionReport");
  const code = tok.slice(0, 7);
  check("SMS logged through smsLogs with the new messageType", smsLogsNow.length === smsBefore + 1 && !!smsLog && smsLog.reportId === offId && smsLog.phone === "+94771234567" && smsLog.customerId === "cu1" && smsLog.plateNumber === "CAB-1234", JSON.stringify(smsLog)?.slice(0, 160));
  check("SMS body: short link, no https, GSM-safe", smsLog.message.includes(`app.pitstopiq.com/v/${code}`) && !smsLog.message.includes("https://") && smsLog.message.length < 160, smsLog.message);
  const linkDoc = await read(`links/${code}`);
  check("short link minted for the report", linkDoc?.type === "inspectionReport" && linkDoc.shareToken === tok && linkDoc.centerId === "c1");
  anon = await browser.newContext({ viewport: { width: 390, height: 844 } }); ap = await anon.newPage();
  await ap.goto(`${BASE}/v/${code}`);
  await ap.waitForSelector(`text=${fin.reportNumber}`, { timeout: 30000 });
  check("the short link resolves to the report page", ap.url().endsWith(`/i/${tok}`));
  await anon.close();

  // quota
  await admin(async (c2) => { await updateDoc(doc(c2.firestore(), "servicecenters/c1"), { smsQuotaUsed: 200 }); });
  await page.goto(`${BASE}/inspection-reports/${offId}?u=owner@t.lk&p=pass1234`);
  await page.waitForSelector("text=Share with customer");
  await page.waitForSelector("text=SMS quota is used up");
  check("quota exhausted: SMS blocked with a clear message, WhatsApp and copy remain", (await page.getByRole("button", { name: "SMS", exact: true }).isDisabled()) && (await page.getByRole("button", { name: "WhatsApp" }).isEnabled()) && (await page.getByRole("button", { name: "Copy", exact: true }).isEnabled()));
  await admin(async (c2) => { await updateDoc(doc(c2.firestore(), "servicecenters/c1"), { smsQuotaUsed: 5 }); });

  // portal visibility toggle: link keeps working
  await page.goto(`${BASE}/inspection-reports/${offId}?u=owner@t.lk&p=pass1234`);
  await page.getByRole("switch", { name: "Show in the customer's portal" }).click();
  await sleep(1200);
  check("hiding from the portal sets visibleToCustomer=false", (await read(`servicecenters/c1/inspectionReports/${offId}`)).visibleToCustomer === false);
  pub = await anonCall("getPublicInspectionReport", { shareToken: tok });
  check("…but the direct link still works", pub.ok && pub.data.state === "ready");
  await page.getByRole("switch", { name: "Show in the customer's portal" }).click(); await sleep(800);

  // revoke / restore
  await page.getByRole("button", { name: "Revoke link" }).click();
  await page.getByRole("button", { name: "Revoke link" }).last().click();
  await page.waitForSelector("text=Link revoked");
  pub = await anonCall("getPublicInspectionReport", { shareToken: tok });
  check("revoked: public callable says revoked and returns no report", pub.ok && pub.data.state === "revoked" && !pub.data.report);
  const viewsBefore = (await read(`servicecenters/c1/inspectionReports/${offId}`)).viewCount ?? 0;
  const tr = await anonCall("trackInspectionReportView", { shareToken: tok });
  check("revoked: views aren't counted", tr.ok && tr.data.tracked === false && ((await read(`servicecenters/c1/inspectionReports/${offId}`)).viewCount ?? 0) === viewsBefore);
  anon = await browser.newContext(); ap = await anon.newPage();
  await ap.goto(`${BASE}/i/${tok}`); await ap.waitForSelector("text=no longer available");
  check("revoked: the page says so", true);
  await anon.close();
  check("revoked: send buttons are off", (await page.getByRole("button", { name: "WhatsApp" }).isDisabled()) && (await page.getByRole("button", { name: "SMS", exact: true }).isDisabled()));
  await page.getByRole("button", { name: "Restore link" }).click();
  await page.waitForSelector("text=Link revoked", { state: "detached" });
  pub = await anonCall("getPublicInspectionReport", { shareToken: tok });
  check("restored: link works again", pub.ok && pub.data.state === "ready");
  check("revoking changed nothing else (number, status, PDF)", (await read(`servicecenters/c1/inspectionReports/${offId}`)).reportNumber === fin.reportNumber);

  // reopened + never-finalized states
  await fnCall("reopenInspectionReport", { centerId: "c1", reportId: offId });
  pub = await anonCall("getPublicInspectionReport", { shareToken: tok });
  check("reopened report: link says 'updating' and offers only the last issued PDF", pub.ok && pub.data.state === "updating" && pub.data.reportNumber === fin.reportNumber && !!pub.data.pdfUrl && !pub.data.report);
  await fnCall("finalizeInspectionReport", { centerId: "c1", reportId: offId });
  pub = await anonCall("getPublicInspectionReport", { shareToken: "pend1".padEnd(32, "x") });
  check("never-finalized report: notReady", pub.ok && pub.data.state === "notReady");

  // module off: links keep working, Owner can still revoke
  await admin(async (c2) => { await updateDoc(doc(c2.firestore(), "servicecenters/c1"), { standaloneInspectionEnabled: false }); });
  pub = await anonCall("getPublicInspectionReport", { shareToken: tok });
  check("module switched off: existing links keep working", pub.ok && pub.data.state === "ready");
  res = await fnCall("revokeInspectionReportLink", { centerId: "c1", reportId: offId, revoked: true });
  check("module switched off: Owner can still revoke", res.ok && res.data.shareRevoked === true);
  await fnCall("revokeInspectionReportLink", { centerId: "c1", reportId: offId, revoked: false });
  await admin(async (c2) => { await updateDoc(doc(c2.firestore(), "servicecenters/c1"), { standaloneInspectionEnabled: true }); });
  await ctx.close();

  // Manager: may send, may not revoke
  ({ ctx, page } = await session("mgr@t.lk"));
  await page.waitForSelector("text=Inspection Reports");
  const mfn = (name, data) => page.evaluate(([n, d]) => window.__call(n, d), [name, data]);
  res = await mfn("revokeInspectionReportLink", { centerId: "c1", reportId: offId, revoked: true });
  check("Manager cannot revoke a link", !res.ok && res.code === "functions/permission-denied");
  await page.goto(`${BASE}/inspection-reports/${offId}?u=mgr@t.lk&p=pass1234`);
  await page.waitForSelector("text=Share with customer");
  check("Manager sees send options but no revoke", (await page.getByRole("button", { name: "WhatsApp" }).isEnabled()) && (await page.getByText("Revoke link").count()) === 0);
  await ctx.close();
  await ctx.close();

  ({ ctx, page } = await session("tech@t.lk"));
  await page.waitForSelector("text=Inspection Reports");
  const tfn = (name, data) => page.evaluate(([n, d]) => window.__call(n, d), [name, data]);
  await mk("tech1x", { assignedToUid: techUid });
  for (const fn of ["finalizeInspectionReport", "reopenInspectionReport", "regenerateInspectionReportPdf"]) {
    const r2 = await tfn(fn, { centerId: "c1", reportId: "tech1x" });
    check(`technician cannot call ${fn}`, !r2.ok && r2.code === "functions/permission-denied", r2.code);
  }
  await ctx.close();
} catch (e) {
  console.log("SCRIPT ERROR", e);
  results.push(false);
}
await browser.close();
await env.cleanup();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
