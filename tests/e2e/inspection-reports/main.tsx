import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import "../../../src/index.css";
import "../../../src/i18n";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../../../src/config/firebase";
import { Ctx } from "./mocks/auth";
import { useOnlineStatus } from "../../../src/hooks/useOnlineStatus";
import { usePhotoUploadQueue } from "../../../src/hooks/usePhotoUploadQueue";
import InspectionReportsGate from "../../../src/components/inspectionReports/InspectionReportsGate";
import InspectionReportListPage from "../../../src/pages/inspectionReports/InspectionReportListPage";
import NewInspectionReportPage from "../../../src/pages/inspectionReports/NewInspectionReportPage";
import InspectionReportEditorPage from "../../../src/pages/inspectionReports/InspectionReportEditorPage";
import InspectionReportPublicView from "../../../src/pages/public/InspectionReportPublicView";
import PublicCustomerView from "../../../src/pages/public/PublicCustomerView";
import VehicleInspectionHistory from "../../../src/components/inspectionReports/VehicleInspectionHistory";
import { useParams } from "react-router-dom";
import ShortLinkResolver from "../../../src/pages/public/ShortLinkResolver";
import InspectionTemplatePage from "../../../src/pages/inspectionReports/InspectionTemplatePage";

// Lets the test call the server functions directly (concurrency, permissions).
(window as any).__call = async (name: string, data: unknown) => {
  try { return { ok: true, data: (await httpsCallable(functions, name)(data)).data }; }
  catch (e: any) { return { ok: false, code: e.code, message: e.message }; }
};

function VehicleHistoryHarness() {
  const { vehicleId } = useParams();
  return <VehicleInspectionHistory centerId="c1" vehicleId={vehicleId!} />;
}

function Boot() {
  useOnlineStatus();
  usePhotoUploadQueue();
  const [user, setUser] = useState<any>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const email = q.get("u"), pw = q.get("p");
    if (!auth.currentUser && email && pw) signInWithEmailAndPassword(auth, email, pw).catch((e) => console.error("signin", e));
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      const staff = await getDoc(doc(db, "servicecenters", "c1", "staff", u.uid));
      setUser({ currentUser: { uid: u.uid, email: u.email, displayName: u.displayName ?? (staff.data()?.fullName ?? ""), centerId: "c1", role: staff.data()?.role, centerPlan: "basic" } });
    });
  }, []);
  if (!user) return <div id="booting">signing in…</div>;
  return (
    <Ctx.Provider value={user}>
      <Routes>
        <Route path="/__vehicle/:vehicleId" element={<VehicleHistoryHarness />} />
        <Route path="/inspection-reports/template" element={<InspectionTemplatePage />} />
        <Route element={<InspectionReportsGate />}>
          <Route path="/inspection-reports" element={<InspectionReportListPage />} />
          <Route path="/inspection-reports/new" element={<NewInspectionReportPage />} />
          <Route path="/inspection-reports/:reportId" element={<InspectionReportEditorPage />} />
        </Route>
        <Route path="*" element={<div id="elsewhere">elsewhere</div>} />
      </Routes>
    </Ctx.Provider>
  );
}
// Public pages (the customer's link and its short link) need no sign-in.
function Switch() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/i/") || pathname.startsWith("/v/") || pathname.startsWith("/c/")) {
    return (
      <Routes>
        <Route path="/i/:shareToken" element={<InspectionReportPublicView />} />
        <Route path="/v/:code" element={<ShortLinkResolver />} />
        <Route path="/c/:centerId/:customerId" element={<PublicCustomerView />} />
      </Routes>
    );
  }
  return <Boot />;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><Switch /></BrowserRouter>);
