import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { LoadingScreen } from "../../components/LoadingProgress";

/**
 * Resolves a short link (pitstopiq.com/v/{code}) to the page it stands for.
 * Looks up the `links/{code}` mapping and redirects to the customer
 * self-service view, or — when the mapping was minted for a distributor — to
 * that distributor's catalog portal.
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
          setTarget(
            d.type === "distributor" ? `/d/${d.centerId}/${d.distributorId}/${d.token}`
            : d.type === "pos" ? `/pos-terminal/${d.centerId}/${d.outletId}/${d.token}`
            : `/c/${d.centerId}/${d.customerId}`,
          );
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
    <LoadingScreen />
  );
}
