import { useMemo } from "react";
import { Calendar } from "lucide-react";

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (start: Date, end: Date) => void;
}

type QuickRange = {
  label: string;
  getRange: () => [Date, Date];
};

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function DateRangePicker({ startDate, endDate, onChange }: DateRangePickerProps) {
  const quickRanges: QuickRange[] = useMemo(() => {
    const now = new Date();
    return [
      {
        label: "This Month",
        getRange: () => {
          const s = new Date(now.getFullYear(), now.getMonth(), 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          return [s, e];
        },
      },
      {
        label: "Last Month",
        getRange: () => {
          const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          return [s, e];
        },
      },
      {
        label: "Last 3 Months",
        getRange: () => {
          const s = new Date(now.getFullYear(), now.getMonth() - 2, 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          return [s, e];
        },
      },
      {
        label: "Last 6 Months",
        getRange: () => {
          const s = new Date(now.getFullYear(), now.getMonth() - 5, 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          return [s, e];
        },
      },
      {
        label: "Year to Date",
        getRange: () => {
          const s = new Date(now.getFullYear(), 0, 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          return [s, e];
        },
      },
      {
        label: "Last 12 Months",
        getRange: () => {
          const s = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          return [s, e];
        },
      },
    ];
  }, []);

  function isActive(range: QuickRange): boolean {
    const [s, e] = range.getRange();
    return (
      toDateInputValue(s) === toDateInputValue(startDate) &&
      toDateInputValue(e) === toDateInputValue(endDate)
    );
  }

  return (
    <div className="bg-[#162032] rounded-xl p-4 border border-white/5 space-y-3">
      <div className="flex items-center gap-2 text-sm text-gray-400 font-medium">
        <Calendar className="h-4 w-4" />
        Date Range
      </div>

      {/* Quick range buttons */}
      <div className="flex flex-wrap gap-2">
        {quickRanges.map((r) => (
          <button
            key={r.label}
            onClick={() => {
              const [s, e] = r.getRange();
              onChange(s, e);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isActive(r)
                ? "bg-[#F97316] text-white"
                : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Custom date inputs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">From</label>
          <input
            type="date"
            value={toDateInputValue(startDate)}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (!isNaN(d.getTime())) onChange(d, endDate);
            }}
            className="bg-[#0B1120] border border-white/10 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#F97316]"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">To</label>
          <input
            type="date"
            value={toDateInputValue(endDate)}
            onChange={(e) => {
              const d = new Date(e.target.value + "T23:59:59");
              if (!isNaN(d.getTime())) onChange(startDate, d);
            }}
            className="bg-[#0B1120] border border-white/10 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#F97316]"
          />
        </div>
      </div>
    </div>
  );
}
