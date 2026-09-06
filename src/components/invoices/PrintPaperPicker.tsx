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
export default function PrintPaperPicker({ center, value, onChange, paper, onSetupHelp }: {
  /** The center document (or anything carrying `invoicePaper`). */
  center: Parameters<typeof resolvePaper>[0];
  value: PaperSizeKey | null;
  onChange: (key: PaperSizeKey | null) => void;
  /** The paper that will actually be printed, for the hint line. */
  paper: ResolvedPaper;
  /** Re-opens the one-time print-setup steps (browser header/footer, margins). */
  onSetupHelp?: () => void;
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
            page's, and the invoice fills whatever that paper is — including
            its length. A 76 × 297 mm sheet therefore feeds 297 mm of paper for
            a receipt that ends after 120. Say so rather than letting it get
            wasted. */}
        Set the same paper ({paper.label}) in the print dialog. The bill fills
        the paper chosen there, so on a roll pick the shortest length your
        driver offers — a longer sheet just feeds blank paper after the bill.
        {onSetupHelp && (
          <>
            {" "}
            <button
              type="button"
              onClick={onSetupHelp}
              className="text-[#F97316] hover:underline font-medium"
            >
              Print setup
            </button>
          </>
        )}
      </p>
    </div>
  );
}
