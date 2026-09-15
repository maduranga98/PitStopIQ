// Sri Lankan phone helpers for the app.
//
// The implementation deliberately does NOT live here. It lives in
// functions/shared/phone.mjs, because the owner's login email is derived twice —
// once by the Cloud Function that provisions the account, once by the login form
// when they sign in months later — and those two derivations must be the same
// code, not two copies of the same intent. They used to be two copies, and they
// had already drifted three ways. See that file's header for the full story.
//
// This module stays as the app's import path so no call site had to change.
export {
  LOGIN_EMAIL_DOMAIN,
  normaliseLocalPhone,
  isMobileLocalPhone,
  phoneToLoginEmail,
  isProvisionedLoginEmail,
  toDisplayPhone,
  loginPhoneVariants,
} from "../../functions/shared/phone.mjs";
