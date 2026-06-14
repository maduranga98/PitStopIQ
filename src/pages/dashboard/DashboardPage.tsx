import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../../components/ui/button";

export default function DashboardPage() {
  const { currentUser, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              Signed in as {currentUser?.email} &middot; Role: {currentUser?.role ?? "—"}
            </p>
          </div>
          <Button variant="outline" onClick={logout}>Sign out</Button>
        </div>
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">Dashboard modules coming soon.</p>
        </div>
      </div>
    </div>
  );
}
