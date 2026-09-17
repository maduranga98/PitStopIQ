/**
 * The sidebar's frame, without any of its data.
 *
 * Rendered by Layout while auth is still resolving, so the shell is painted on
 * the first frame instead of waiting on the profile chain. Deliberately
 * frame-only — logo, dividers and the fixed-height regions the real Navbar
 * occupies — because placeholder nav rows would be a second thing to swap out
 * on a fast (cached) resolve. Geometry mirrors Navbar's expanded state exactly
 * (w-60 rail, h-16 logo bar, h-14 mobile bar) so the handover doesn't shift
 * anything on screen.
 */
export default function NavbarSkeleton() {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col bg-[#162032] border-r border-white/10 h-screen sticky top-0 flex-shrink-0 w-60">
        <div className="flex items-center gap-2 px-4 h-16 border-b border-white/10 flex-shrink-0">
          <img
            src="/logo.png"
            alt="PitStop IQ"
            className="h-7 w-auto flex-shrink-0"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <span className="text-base font-extrabold tracking-tight text-white truncate">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </span>
        </div>
        <div className="flex-1" />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center bg-[#162032] border-b border-white/10 px-4 h-14 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="PitStop IQ"
            className="h-7 w-auto"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <span className="text-base font-extrabold tracking-tight text-white">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </span>
        </div>
      </div>
    </>
  );
}
