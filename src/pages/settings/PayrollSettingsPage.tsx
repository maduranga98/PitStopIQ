import { useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import PayrollSettings from "../../components/settings/PayrollSettings";

/**
 * The standalone Payroll page reached from the sidebar. The controls
 * themselves live in <PayrollSettings/>, which Settings > Payroll renders too,
 * so both routes stay in step.
 */
export default function PayrollSettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Wallet className="w-5 h-5" />}
        title="Payroll"
        actions={
          <button
            onClick={() => navigate("/employees")}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            Employees
          </button>
        }
      />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PayrollSettings />
      </div>
    </div>
  );
}
