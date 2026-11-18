import { useEffect, useState } from "react";
import { doc, serverTimestamp } from "firebase/firestore";
import { Check, Fingerprint, Pencil, X } from "lucide-react";
import { db } from "../../config/firebase";
import { boundedGetDoc } from "../../lib/firestoreRead";
import { safeSetDoc } from "../../lib/firestoreWrite";
import { inputClass } from "./AdminModal";

/** `centerAdminMeta/{centerId}` — super-admin-only, so it never rides on the public center document. */
interface Meta {
  specialId: string;
  note: string;
  updatedByName?: string;
}

const MAX_ID = 40;
const MAX_NOTE = 2000;

/**
 * A special ID and an optional private note on a service center — the
 * super admin's own reference ("PIQ-KUR-0012", "pays by cash, ask for Nimal").
 *
 * Lives in its own document rather than on `servicecenters/{id}`: that one is
 * publicly readable (it backs the customer share link), so anything put on it
 * would be public.
 */
export default function CenterAdminMeta({ centerId, adminName }: { centerId: string; adminName: string }) {
  const [saved, setSaved] = useState<Meta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [specialId, setSpecialId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    boundedGetDoc(doc(db, "centerAdminMeta", centerId))
      .then((snap) => {
        if (!live) return;
        setSaved(snap.exists() ? (snap.data() as Meta) : null);
        setLoaded(true);
      })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [centerId]);

  function startEdit() {
    setSpecialId(saved?.specialId ?? "");
    setNote(saved?.note ?? "");
    setError("");
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    const next: Meta = {
      specialId: specialId.trim().slice(0, MAX_ID),
      note: note.trim().slice(0, MAX_NOTE),
      updatedByName: adminName,
    };
    setSaving(true);
    setError("");
    try {
      await safeSetDoc(doc(db, "centerAdminMeta", centerId), { ...next, updatedAt: serverTimestamp() }, { merge: true });
      setSaved(next);
      setEditing(false);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const empty = !saved?.specialId && !saved?.note;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-orange-400" /> Special ID &amp; note
          <span className="text-[10px] font-medium text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">Only you can see this</span>
        </h2>
        {!editing && loaded && (
          <button
            onClick={startEdit}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> {empty ? "Add" : "Edit"}
          </button>
        )}
      </div>

      {!loaded ? (
        <p className="text-xs text-gray-600 mt-3">Loading…</p>
      ) : editing ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-400 mb-1.5">Special ID</span>
            <input
              className={`${inputClass} font-mono`}
              value={specialId}
              onChange={(e) => setSpecialId(e.target.value)}
              placeholder="e.g. PIQ-KUR-0012"
              maxLength={MAX_ID}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-400 mb-1.5">Note (optional)</span>
            <textarea
              className={`${inputClass} min-h-[6rem] resize-y`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth remembering about this center"
              maxLength={MAX_NOTE}
            />
          </label>
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white transition-colors"
            >
              <Check className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </div>
      ) : empty ? (
        <p className="text-xs text-gray-600 mt-3">No special ID or note yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {saved?.specialId && (
            <p className="text-sm text-white font-mono bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 w-fit">
              {saved.specialId}
            </p>
          )}
          {saved?.note && <p className="text-sm text-gray-300 whitespace-pre-wrap">{saved.note}</p>}
        </div>
      )}
    </div>
  );
}
