import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../config/firebase";

/**
 * Resolves a short link (pitstopiq.com/v/{code}) to the full customer
 * self-service view. Looks up the `links/{code}` mapping written by
 * getOrCreateShortLink and redirects to /c/{centerId}/{customerId}.
 */
export default function ShortLinkResolver() {
  const { code } = useParams<{ code: string }>();
  const [target, setTarget] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!code) return;
    let active = true;
    getDoc(doc(db, "links", code))
      .then((snap) => {
        if (!active) return;
        if (snap.exists()) {
          const d = snap.data();
          setTarget(`/c/${d.centerId}/${d.customerId}`);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => { if (active) setNotFound(true); });
    return () => { active = false; };
  }, [code]);

  if (target) return <Navigate to={target} replace />;

  if (notFound || !code) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <div className="text-lg font-semibold text-white mb-2">Link not found</div>
          <p className="text-sm text-gray-400">
            This link is invalid or has expired. Please contact your service center for an up-to-date link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-gray-400">
      Loading…
    </div>
  );
}
