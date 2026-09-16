import { PRINT_CLASS } from "../../lib/printPaper";

/**
 * The service center's details as they print at the head of a bill.
 *
 * The logo has the first line to itself and the name follows on the second.
 * Side by side they competed for the same row: a logo takes 64px of a column
 * that is only ~90mm wide on A4 and ~70mm on a roll, and the name — the
 * largest line on the bill, and the one fitPrintOneLiners shrinks to keep on
 * one line — is what paid for it, printing a size or two smaller than it
 * should. Stacked, the name gets the full column width and stays large.
 *
 * Contact lines are printed only when the center has them: a second mobile
 * number and an email are optional (see ServiceCenter.phone2 / .email), and
 * they share one line so the letterhead never grows past four.
 */
export interface LetterheadCenter {
  name?: string;
  address?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  logoUrl?: string;
}

export default function InvoiceLetterhead({ center }: { center: LetterheadCenter | null | undefined }) {
  // One line, joined by a middot: two numbers on two lines is a line of paper
  // (and of A4 header) spent on nothing.
  const phones = [center?.phone, center?.phone2].filter((p) => p && p.trim()).join(" · ");

  return (
    <div>
      {center?.logoUrl && (
        <img
          src={center.logoUrl}
          alt=""
          className={PRINT_CLASS.orgLogo}
          style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, border: "1px solid #e5e7eb", marginBottom: 10 }}
        />
      )}
      <div className={`${PRINT_CLASS.orgName} text-2xl font-extrabold text-gray-900`}>{center?.name ?? ""}</div>
      {center?.address && (
        <div className={`${PRINT_CLASS.orgAddress} text-sm text-gray-500 mt-1`}>{center.address}</div>
      )}
      {phones && <div className={`${PRINT_CLASS.orgContact} text-sm text-gray-500`}>{phones}</div>}
      {center?.email && <div className={`${PRINT_CLASS.orgContact} text-sm text-gray-500`}>{center.email}</div>}
    </div>
  );
}
