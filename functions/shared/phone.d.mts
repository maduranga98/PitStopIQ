// Types for shared/phone.mjs, hand-written so the app can import the canonical
// implementation without turning on allowJs for the whole project.
export declare const LOGIN_EMAIL_DOMAIN: "pitstopiq.app";
export declare function normaliseLocalPhone(raw: string | null | undefined): string | null;
export declare function isMobileLocalPhone(local: string | null | undefined): boolean;
export declare function phoneToLoginEmail(raw: string | null | undefined): string | null;
export declare function isProvisionedLoginEmail(email: string | null | undefined): boolean;
export declare function toDisplayPhone(raw: string | null | undefined): string | null;
export declare function loginPhoneVariants(raw: string | null | undefined): string[];
