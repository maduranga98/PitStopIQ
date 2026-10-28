/**
 * The message the super admin pastes into WhatsApp when handing over a caller
 * account. Plain text on purpose, like the service-center handover: WhatsApp's
 * markup renders inconsistently and a stray asterisk around a password is a
 * support call.
 */
export function buildCallerHandoverMessage(args: {
  name: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
}): string {
  const first = args.name.trim().split(/\s+/)[0] || "there";
  return [
    `Hello ${first},`,
    ``,
    `Your PitStop IQ lead account is ready.`,
    ``,
    `Sign in: ${args.loginUrl}`,
    `Email: ${args.email}`,
    `Password: ${args.tempPassword}`,
    ``,
    `You can set your own password any time with "Forgot password?" on the sign-in page.`,
  ].join("\n");
}
