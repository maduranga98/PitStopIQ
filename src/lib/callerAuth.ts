/**
 * Caller sign-in failures, in words a lead handler can act on. Kept free of
 * Firebase imports so the mapping can be unit-tested.
 */

export type CallerAuthFailure = "not-a-caller" | "deactivated";

/** Thrown by CallerContext.login after a correct password but an unusable account. */
export class CallerAuthError extends Error {
  readonly reason: CallerAuthFailure;
  constructor(reason: CallerAuthFailure) {
    super(reason === "deactivated" ? DEACTIVATED_MESSAGE : NOT_A_CALLER_MESSAGE);
    this.name = "CallerAuthError";
    this.reason = reason;
  }
}

export const DEACTIVATED_MESSAGE = "This account has been deactivated. Contact an admin.";
export const NOT_A_CALLER_MESSAGE = "This isn't a caller account.";

export function callerLoginErrorMessage(err: unknown): string {
  const e = err as { reason?: string; code?: string; message?: string } | null;
  if (e?.reason === "deactivated") return DEACTIVATED_MESSAGE;
  if (e?.reason === "not-a-caller") return NOT_A_CALLER_MESSAGE;

  switch (e?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes, or reset your password.";
    case "auth/user-disabled":
      return DEACTIVATED_MESSAGE;
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    default:
      return "Couldn't sign in. Try again.";
  }
}
