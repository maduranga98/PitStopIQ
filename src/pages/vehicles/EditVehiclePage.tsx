import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Vehicle } from "../../types/auth";
import AddVehiclePage from "./AddVehiclePage";

export default function EditVehiclePage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vehicleId || !currentUser?.centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicleId),
      (snap) => {
        if (snap.exists()) {
          setVehicle({ id: snap.id, ...snap.data() } as Vehicle);
        } else {
          navigate("/vehicles");
        }
        setLoading(false);
      },
    );
  }, [vehicleId, currentUser?.centerId, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!vehicle) return null;

  return <AddVehiclePage vehicleId={vehicleId} initialData={vehicle} />;
}
