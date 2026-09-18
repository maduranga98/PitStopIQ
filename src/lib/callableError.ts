import type { FunctionsError } from "firebase/functions";

/**
 * Turns a failed httpsCallable() call into something a user can act on.
 *
 * The messages our callables throw themselves ("Only the Owner can…",
 * "That staff member no longer exists.") are already written for the person
 * reading them, so those pass straight through. The problem is everything
 * else: when the browser cannot reach the function at all — it is not
 * deployed, the deploy failed, its Cloud Run invoker is not public, or the
 * device is offline — the preflight request comes back without CORS headers
 * and the Firebase SDK reports that as `code: "internal"` with the message
 * literally being "internal". Showing that raw in the UI tells the user
 * nothing and reads like data loss.
 *
 * Codes: https://firebase.google.com/docs/reference/js/functions#functionserrorcode
 */
export function callableErrorMessage(err: unknown, fallback: string): string {
  const fnErr = err as Partial<FunctionsError> | undefined;
  const code = typeof fnErr?.code === "string" ? fnErr.code.replace(/^functions\//, "") : "";
  const message = typeof fnErr?.message === "string" ? fnErr.message.trim() : "";

  switch (code) {
    // The SDK's bucket for "the HTTP request never produced a usable
    // response" — no network, blocked preflight, or a function that is not
    // there. Its message is a copy of the code, so there is nothing to show.
    case "internal":
    case "unavailable":
    case "deadline-exceeded":
    case "cancelled":
      return "Could not reach the server. Check your connection and try again — "
        + "if this keeps happening, this feature needs to be re-deployed.";

    case "unauthenticated":
      return "Your session has expired. Please sign in again.";

    case "resource-exhausted":
      return "Too many attempts. Please wait a moment and try again.";

    // permission-denied, failed-precondition, not-found, invalid-argument and
    // friends are thrown by our own code with a sentence meant for the user.
    default:
      return message && message !== code ? message : fallback;
  }
}
