// ── Amount in words ──────────────────────────────────────────────────────────
// Every bill a Sri Lankan shop hands over states its total twice: once in
// figures and once spelled out. It is what the customer's own book-keeper
// reads, and on a receipt printed at 72 dpi it is also the safety net — a
// figure whose dots half-landed is still unambiguous when the line under it
// says "Nine Hundred Only".

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/** 0–999 in words. */
function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r ? `${t} ${ONES[r]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} Hundred`;
  const r = n % 100;
  return r ? `${h} ${underThousand(r)}` : h;
}

// The scale a bill is read out in here: lakhs and crores are understood, but
// invoices are written in the international scale, so that is what is used.
const SCALES: [number, string][] = [
  [1_000_000_000, "Billion"],
  [1_000_000, "Million"],
  [1_000, "Thousand"],
];

/** A whole number in words. Beyond a billion it falls back to the figures. */
function wholeInWords(n: number): string {
  if (n === 0) return ONES[0];
  if (n >= 1_000_000_000_000) return n.toLocaleString("en-LK");

  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      parts.push(`${underThousand(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (rest > 0) parts.push(underThousand(rest));
  return parts.join(" ");
}

/**
 * The amount as it goes on the bill: "LKR Nine Hundred Only", or
 * "LKR One Thousand Two Hundred and Fifty Cents Seventy Five Only" when there
 * are cents. Rounds to the cent first — the figure and the words must agree.
 */
export function amountInWords(amount: number, currency = "LKR"): string {
  if (!isFinite(amount)) return "";

  const negative = amount < 0;
  const cents = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(cents / 100);
  const paisa = cents % 100;

  let words = wholeInWords(rupees);
  if (paisa > 0) words += ` and Cents ${underThousand(paisa)}`;

  return `${negative ? "Minus " : ""}${currency} ${words} Only`;
}
