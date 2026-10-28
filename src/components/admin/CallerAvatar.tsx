/** Two-letter initials in a small circle; the full name is the tooltip. */
function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

export default function CallerAvatar({ name, size = "sm" }: { name?: string | null; size?: "sm" | "md" }) {
  const dim = size === "md" ? "w-7 h-7 text-[11px]" : "w-5 h-5 text-[9px]";
  return (
    <span
      title={name ?? "Unassigned"}
      className={`${dim} rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 font-semibold flex items-center justify-center flex-shrink-0`}
    >
      {initials(name)}
    </span>
  );
}
