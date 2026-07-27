import { Download } from "lucide-react";

// The shapes every report on this page is built from: stat tiles, a card with
// an optional CSV export, and the note that stands in for an empty chart.

export function StatTiles({
  tiles,
}: {
  tiles: { label: string; value: string; sub?: string; tone?: string }[];
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {tiles.map(t => (
        <div key={t.label} className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t.label}</div>
          <div className={`text-2xl font-bold ${t.tone ?? "text-white"}`}>{t.value}</div>
          {t.sub && <div className="text-xs text-gray-600 mt-0.5">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function ReportCard({
  title,
  onExport,
  children,
}: {
  title: string;
  onExport?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {onExport && (
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="text-center text-gray-500 py-8 text-sm">{children}</div>;
}
