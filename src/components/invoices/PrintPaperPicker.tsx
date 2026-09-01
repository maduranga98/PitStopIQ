import { Printer } from "lucide-react";
import {
  PAPER_SIZES, PRINT_PICKER_SIZES, resolvePaper,
  type PaperSizeKey, type ResolvedPaper,
} from "../../lib/printPaper";

/**
 * Size picker that sits next to the Print button. The center setting is the
 * default; this is the escape hatch for the one invoice that has to come out
 * on different paper — a receipt-roll shop printing a full A4 copy for a
 * customer, or the other way round.
 */
export default function PrintPaperPicker({ center, value, onChange, paper }: {
  /** The center document (or anything carrying `invoicePaper`). */
  center: Parameters<typeof resolvePaper>[0];
  value: PaperSizeKey | null;
  onChange: (key: PaperSizeKey | null) => void;
  /** The paper that will actually be printed, for the hint line. */
  paper: ResolvedPaper;
}) {
  const centerPaper = resolvePaper(center);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 bg-white/10 text-white px-3 py-1.5 rounded-lg text-sm cursor-pointer">
        <Printer className="w-4 h-4 shrink-0" />
        <span className="sr-only">Paper size</span>
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as PaperSizeKey))}
          className="bg-transparent text-white text-sm focus:outline-none cursor-pointer [&>option]:bg-[#162032]"
        >
          <option value="">Shop default — {centerPaper.label}</option>
          {PRINT_PICKER_SIZES.map((key) => (
            <option key={key} value={key}>{PAPER_SIZES[key].label}</option>
          ))}
        </select>
      </label>
      <p className="hidden sm:block text-[11px] text-gray-500 max-w-[16rem]">
        {/* Chrome and Edge let the print dialog's own paper size win over the
            page's, which is how a 76mm receipt ends up centred on a blank A4
            sheet. Say so here rather than letting the paper get wasted. */}
        Set the same paper ({paper.label}) in the print dialog, or the invoice
        prints at this width on the printer's default sheet.
      </p>
    </div>
  );
}
