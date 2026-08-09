import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, WifiOff, UserX, LifeBuoy } from "lucide-react";
import type { AuthIssue } from "../../contexts/AuthContext";
import { SUPPORT_CONTACT, hasSupportContact, whatsappLink } from "../../lib/support";

// Shown when a sign-in produced a valid Firebase session but the user still
// can't be let into the app. Every one of these cases used to end with the
// login form quietly re-rendering — the user pressed "Sign In", the password
// was accepted, and they were left looking at the same page with no idea why.
// This screen names the reason and gives the one action that can fix it.

interface Props {
  issue: AuthIssue;
  // Re-run the profile read for the still-signed-in user.
  onRetry?: () => Promise<void>;
  // Drop the session / dismiss the issue and go back to the login form.
  onSignOut?: () => Promise<void> | void;
  // Offered only for accounts that could plausibly finish onboarding themselves.
  onRegister?: () => void;
  // The phone/email the user signed in with — support's first question.
  accountLabel?: string | null;
}

export function AuthIssueScreen({ issue, onRetry, onSignOut, onRegister, accountLabel }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"retry" | "signout" | null>(null);

  async function run(which: "retry" | "signout", fn?: () => Promise<void> | void) {
    if (!fn) return;
    setBusy(which);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const copy = {
    network: {
      icon: <WifiOff className="h-6 w-6 text-amber-400" />,
      tone: "border-amber-500/30 bg-amber-500/10",
      title: t("authIssue.networkTitle"),
      body: t("authIssue.networkBody"),
      showSupport: false,
    },
    "no-profile": {
      icon: <LifeBuoy className="h-6 w-6 text-orange-400" />,
      tone: "border-orange-500/30 bg-orange-500/10",
      title: t("authIssue.noProfileTitle"),
      body: t("authIssue.noProfileBody"),
      showSupport: true,
    },
    "access-removed": {
      icon: <UserX className="h-6 w-6 text-red-400" />,
      tone: "border-red-500/30 bg-red-500/10",
      title: t("authIssue.accessRemovedTitle"),
      body: t("authIssue.accessRemovedBody"),
      showSupport: false,
    },
    unknown: {
      icon: <AlertTriangle className="h-6 w-6 text-red-400" />,
      tone: "border-red-500/30 bg-red-500/10",
      title: t("authIssue.unknownTitle"),
      body: t("authIssue.unknownBody"),
      showSupport: true,
    },
  }[issue.kind];

  // Retrying only helps while the session is still live and the data might
  // have changed under us; once we've signed the user out there's nothing to
  // re-read.
  const canRetry = Boolean(onRetry) && issue.kind !== "access-removed";

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#162032] border border-white/10 rounded-2xl shadow-2xl p-8">
        <div className={`mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border ${copy.tone}`}>
          {copy.icon}
        </div>

        <h1 className="text-center text-lg font-semibold text-white">{copy.title}</h1>
        <p className="mt-2 text-center text-sm text-gray-400">{copy.body}</p>

        {accountLabel && (
          <p className="mt-4 text-center text-xs text-gray-500">
            {t("authIssue.signedInAs")}{" "}
            <span className="font-mono text-gray-400">{accountLabel}</span>
          </p>
        )}

        {copy.showSupport && (
          <div className="mt-5 rounded-lg border border-white/10 bg-[#0B1120] px-4 py-3 text-center">
            <p className="text-xs text-gray-500">{t("authIssue.contactSupport")}</p>
            {/* Support channels are configured in src/lib/support.ts; until
                they're filled in we say who to contact without inventing a
                number to call. */}
            {hasSupportContact() && (
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm font-medium">
                {SUPPORT_CONTACT.phone && (
                  <a href={`tel:${SUPPORT_CONTACT.phone}`} className="text-[#F97316] hover:text-[#fb923c]">
                    {SUPPORT_CONTACT.phoneDisplay || SUPPORT_CONTACT.phone}
                  </a>
                )}
                {SUPPORT_CONTACT.whatsapp && (
                  <a
                    href={whatsappLink("I can't sign in to PitStopIQ.")}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#F97316] hover:text-[#fb923c]"
                  >
                    WhatsApp
                  </a>
                )}
                {SUPPORT_CONTACT.email && (
                  <a href={`mailto:${SUPPORT_CONTACT.email}`} className="text-[#F97316] hover:text-[#fb923c]">
                    {SUPPORT_CONTACT.email}
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 space-y-2">
          {canRetry && (
            <button
              type="button"
              onClick={() => run("retry", onRetry)}
              disabled={busy !== null}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#F97316] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#ea6c0f] disabled:opacity-60"
            >
              {busy === "retry" && <Spinner />}
              {busy === "retry" ? t("authIssue.retrying") : t("authIssue.tryAgain")}
            </button>
          )}

          {onRegister && (
            <button
              type="button"
              onClick={onRegister}
              disabled={busy !== null}
              className="w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/20 disabled:opacity-60"
            >
              {t("authIssue.completeRegistration")}
            </button>
          )}

          {onSignOut && (
            <button
              type="button"
              onClick={() => run("signout", onSignOut)}
              disabled={busy !== null}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-white/5 disabled:opacity-60"
            >
              {busy === "signout" && <Spinner />}
              {t("authIssue.backToLogin")}
            </button>
          )}
        </div>

        {issue.detail && (
          <details className="mt-5 text-xs text-gray-600">
            <summary className="cursor-pointer hover:text-gray-400">{t("authIssue.details")}</summary>
            <p className="mt-2 break-words rounded bg-black/30 p-2 font-mono text-[11px] text-gray-500">
              {issue.detail}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
