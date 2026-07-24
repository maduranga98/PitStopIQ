import { useState } from "react";

// Shown when the user is genuinely signed in with Firebase but their profile
// (centerId/role) couldn't be read because a Firestore read failed on the
// network. This is deliberately NOT the login form: the session is still
// valid, so bouncing to /login would misrepresent a load failure as a sign-in
// failure. "Try again" simply re-runs the profile read.
export function ProfileRetryScreen({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <svg className="h-6 w-6 text-[#E8272A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656M5.636 5.636a9 9 0 000 12.728m3.536-3.536a4 4 0 010-5.656" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">Couldn't load your profile</h1>
        <p className="mt-2 text-sm text-gray-500">
          You're still signed in, but we couldn't reach the server to load your
          account. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#E8272A] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#c81f22] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying && (
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {retrying ? "Retrying…" : "Try again"}
        </button>
      </div>
    </div>
  );
}
