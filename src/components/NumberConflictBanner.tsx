import { AlertTriangle } from "lucide-react";

/**
 * Shown on an invoice or job card that shares its number with another document
 * in the same centre.
 *
 * Numbers are allocated on the client — by reading the highest one already used
 * this month and adding one — so that a bill can be written up with no
 * connection. The cost is that two tablets at the same counter, or one working
 * offline against its cached copy, can both read the same "last" number.
 *
 * The app deliberately does NOT renumber automatically: by the time a duplicate
 * syncs, this document may already have been printed and handed to a customer,
 * and silently changing a number that exists on paper is worse than having two
 * of them. So it says so, and a human decides.
 */
export default function NumberConflictBanner({
  kind,
  number,
}: {
  kind: "invoice" | "job";
  number: string;
}) {
  const label = kind === "invoice" ? "invoice" : "job card";
  return (
    <div
      role="alert"
      className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3"
    >
      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-amber-200">
        <p className="font-medium">
          Another {label} already uses the number {number}.
        </p>
        <p className="text-amber-200/80 mt-0.5">
          This usually means two devices created one at the same time, or one was
          created offline. Nothing has been changed automatically — if this {label}{" "}
          has not been printed yet, give it a new number.
        </p>
      </div>
    </div>
  );
}
