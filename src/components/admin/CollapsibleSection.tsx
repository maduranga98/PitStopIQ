import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** A card whose body stays hidden until the header arrow is clicked. */
export default function CollapsibleSection({
  icon, title, count, defaultOpen = false, children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <ChevronRight className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`} />
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">{icon}{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[11px] font-medium text-gray-400 bg-gray-800 rounded-full px-2 py-0.5">{count}</span>
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
