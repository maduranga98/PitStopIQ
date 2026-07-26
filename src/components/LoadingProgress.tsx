import { useTranslation } from "react-i18next";

import { useLoadingProgress, type ProgressOptions } from "../hooks/useLoadingProgress";

export type LoaderTheme = "dark" | "light";

function ProgressRing({
  percent,
  size,
  theme,
}: {
  percent: number;
  size: number;
  theme: LoaderTheme;
}) {
  const strokeWidth = size >= 72 ? 5 : 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const track = theme === "dark" ? "rgba(255,255,255,0.10)" : "#E5E7EB";
  const bar = theme === "dark" ? "#F97316" : "#E8272A";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bar}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          style={{ transition: "stroke-dashoffset 150ms linear" }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums ${
          size >= 72 ? "text-base" : "text-xs"
        } ${theme === "dark" ? "text-white" : "text-gray-900"}`}
      >
        {percent}%
      </span>
    </div>
  );
}

interface LoaderProps extends ProgressOptions {
  theme?: LoaderTheme;
  /** Overrides the default "Loading…" caption. */
  label?: string;
}

/**
 * Full-screen loading state with a percentage indicator. Use for route-level
 * and auth-gate loads that block the whole page.
 */
export function LoadingScreen({ theme = "dark", label, ...options }: LoaderProps) {
  const { t } = useTranslation();
  const { percent, seconds, slow, stuck } = useLoadingProgress(options);
  const caption = label ?? t("loader.label");

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center gap-4 px-6 ${
        theme === "dark" ? "bg-[#0B1120]" : "bg-gray-50"
      }`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={caption}
    >
      <ProgressRing percent={percent} size={76} theme={theme} />
      <div className="text-center">
        <p className={`text-sm font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
          {caption}
        </p>
        {slow && (
          <p className={`mt-1.5 text-xs ${theme === "dark" ? "text-gray-500" : "text-gray-400"}`}>
            {stuck ? t("loader.stuck") : t("loader.slow")} · {t("loader.elapsed", { seconds })}
          </p>
        )}
      </div>
      {stuck && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
            theme === "dark"
              ? "bg-[#F97316] text-white hover:bg-[#ea6c0f]"
              : "bg-[#E8272A] text-white hover:bg-[#c81f22]"
          }`}
        >
          {t("loader.reload")}
        </button>
      )}
    </div>
  );
}

/**
 * Inline loading state with a percentage indicator, for a section of an
 * already-rendered page (a table body, a card list) rather than the whole
 * screen.
 */
export function LoadingBlock({
  theme = "dark",
  label,
  className = "py-20",
  ...options
}: LoaderProps & { className?: string }) {
  const { t } = useTranslation();
  const { percent, seconds, slow, stuck } = useLoadingProgress(options);
  const caption = label ?? t("loader.label");

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={caption}
    >
      <ProgressRing percent={percent} size={52} theme={theme} />
      <div className="text-center">
        <p className={`text-xs font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
          {caption}
        </p>
        {slow && (
          <p className={`mt-1 text-[11px] ${theme === "dark" ? "text-gray-500" : "text-gray-400"}`}>
            {stuck ? t("loader.stuck") : t("loader.slow")} · {t("loader.elapsed", { seconds })}
          </p>
        )}
      </div>
    </div>
  );
}
