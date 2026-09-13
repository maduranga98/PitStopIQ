import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Eraser, PenLine, X } from "lucide-react";

/**
 * The valuables waiver a customer signs before the workshop touches the
 * vehicle: they confirm nothing of value was left inside, declare anything
 * they did leave, and sign for it. Some customers insist on it, and a
 * disputed phone or wallet after the fact is exactly what it settles.
 *
 * Deliberately full-screen: it is handed to the customer on a tablet or
 * phone, so the text has to be readable and the signing area large. The
 * waiver itself is shown in all three languages at once — the customer reads
 * whichever they read, regardless of the language the staff run the app in.
 */

export interface CapturedSignature {
  /** PNG data URL of the drawn signature. */
  dataUrl: string;
  /** Who signed — the customer, or whoever brought the vehicle in. */
  signedByName: string;
  /** Items the customer declared as left in the vehicle. "" when none. */
  valuables: string;
  /** Whether anything at all was declared. */
  hasValuables: boolean;
  /** When it was signed (ISO string; the caller stamps the stored record). */
  signedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (signature: CapturedSignature) => void;
  plateNumber?: string;
  /** Pre-fills who is signing — usually the customer on the job. */
  customerName?: string;
}

/** The waiver, in the three languages the app runs in. */
const WAIVER: { lang: string; label: string; heading: string; body: string }[] = [
  {
    lang: "en",
    label: "English",
    heading: "Valuables & liability",
    body:
      "I confirm that I have removed all valuable items from this vehicle before handing it over "
      + "for service, and that anything I have left inside is declared below. I understand that the "
      + "service centre takes no responsibility for cash, jewellery, documents, electronics or any "
      + "other valuables left in the vehicle, and that nothing left undeclared can be claimed for "
      + "after the service.",
  },
  {
    lang: "si",
    label: "සිංහල",
    heading: "වටිනා භාණ්ඩ හා වගකීම",
    body:
      "සේවා කටයුතු සඳහා මෙම වාහනය භාර දීමට පෙර එහි තිබූ සියලුම වටිනා භාණ්ඩ මම ඉවත් කර ඇති බවත්, "
      + "වාහනය තුළ තබා යන ඕනෑම දෙයක් පහත ප්‍රකාශ කර ඇති බවත් සහතික කරමි. වාහනය තුළ තබා ගිය මුදල්, "
      + "රන් භාණ්ඩ, ලියකියවිලි, විද්‍යුත් උපකරණ හෝ වෙනත් කිසිදු වටිනා භාණ්ඩයක් සම්බන්ධයෙන් සේවා "
      + "මධ්‍යස්ථානය කිසිදු වගකීමක් නොගන්නා බවත්, ප්‍රකාශ නොකළ කිසිවක් සේවයෙන් පසුව ඉල්ලා සිටිය "
      + "නොහැකි බවත් මම තේරුම් ගනිමි.",
  },
  {
    lang: "ta",
    label: "தமிழ்",
    heading: "விலையுயர்ந்த பொருட்கள் & பொறுப்பு",
    body:
      "சேவைக்காக இந்த வாகனத்தை ஒப்படைப்பதற்கு முன் அதில் இருந்த அனைத்து விலையுயர்ந்த பொருட்களையும் "
      + "நான் அகற்றியுள்ளேன் என்பதையும், வாகனத்தில் விட்டுச்செல்லும் எதுவும் கீழே அறிவிக்கப்பட்டுள்ளது "
      + "என்பதையும் உறுதிப்படுத்துகிறேன். வாகனத்தில் விடப்பட்ட பணம், நகைகள், ஆவணங்கள், மின்னணு "
      + "சாதனங்கள் அல்லது வேறு எந்த விலையுயர்ந்த பொருட்களுக்கும் சேவை நிலையம் எந்தப் பொறுப்பையும் "
      + "ஏற்காது என்பதையும், அறிவிக்கப்படாத எந்தப் பொருளுக்கும் சேவைக்குப் பிறகு உரிமை கோர முடியாது "
      + "என்பதையும் நான் புரிந்துகொள்கிறேன்.",
  },
];

/** Both Indic faces, so the waiver renders in its own script on any device. */
function ensureWaiverFonts() {
  if (typeof document === "undefined") return;
  const href =
    "https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@400..700"
    + "&family=Noto+Sans+Tamil:wght@400..700&display=swap";
  if (document.querySelector(`link[data-waiver-fonts="1"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.waiverFonts = "1";
  document.head.appendChild(link);
}

/** The exported signature's width in CSS pixels — small enough to store. */
const EXPORT_WIDTH = 600;

export default function CustomerSignatureModal(props: Props) {
  // Mounting the body only while open resets the pad and the declaration
  // between customers — a signature must never carry over to the next job.
  if (!props.open) return null;
  return <SignatureBody {...props} />;
}

function SignatureBody({ onClose, onConfirm, plateNumber, customerName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [signedByName, setSignedByName] = useState(customerName ?? "");
  const [hasValuables, setHasValuables] = useState(false);
  const [valuables, setValuables] = useState("");
  const [error, setError] = useState("");

  useEffect(ensureWaiverFonts, []);

  // Size the pad to its box at device resolution, so a stylus line is crisp
  // and doesn't come out stretched on a phone.
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    // Resizing clears the bitmap, so this only runs while the pad is empty.
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0B1120";
  }, []);

  useEffect(() => {
    fitCanvas();
    const onResize = () => { if (!hasInk) fitCanvas(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitCanvas, hasInk]);

  function pointOf(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pointOf(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap alone should leave a mark, not nothing.
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    setHasInk(true);
    setError("");
  }

  function extendStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointOf(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endStroke() { drawing.current = false; }

  function clearPad() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
  }

  /** The pad, flattened onto white and scaled down to a storable PNG. */
  function exportSignature(): string | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const scale = EXPORT_WIDTH / canvas.width;
    const out = document.createElement("canvas");
    out.width = EXPORT_WIDTH;
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    // White behind the strokes: the signature is printed and viewed on paper
    // and on light backgrounds, where a transparent PNG would vanish.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  function confirm() {
    if (!hasInk) { setError("Ask the customer to sign above first."); return; }
    if (!signedByName.trim()) { setError("Enter the name of whoever is signing."); return; }
    if (hasValuables && !valuables.trim()) {
      setError("List the valuables being left in the vehicle, or switch back to “nothing left”.");
      return;
    }
    const dataUrl = exportSignature();
    if (!dataUrl) { setError("Couldn't capture the signature — try again."); return; }
    onConfirm({
      dataUrl,
      signedByName: signedByName.trim(),
      valuables: hasValuables ? valuables.trim() : "",
      hasValuables,
      signedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#0B1120] flex flex-col print:hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-16 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
            <PenLine className="w-4.5 h-4.5 text-orange-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-white truncate">Customer Signature</h2>
            <p className="text-[11px] text-gray-500 truncate">
              Valuables waiver{plateNumber ? ` · ${plateNumber}` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* The waiver, in all three languages */}
          <div className="grid gap-3">
            {WAIVER.map((w) => (
              <div
                key={w.lang}
                lang={w.lang}
                className="bg-[#162032] border border-white/10 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">
                    {w.label}
                  </span>
                  <span className="text-xs font-semibold text-gray-300">{w.heading}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-gray-300">{w.body}</p>
              </div>
            ))}
          </div>

          {/* Declaration */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              Anything of value left in the vehicle?
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setHasValuables(false); setError(""); }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  !hasValuables ? "border-orange-500 bg-orange-500/10" : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                <Check className={`w-4 h-4 flex-shrink-0 ${!hasValuables ? "text-orange-400" : "text-gray-500"}`} />
                <span className="text-sm font-semibold text-white">Nothing left</span>
              </button>
              <button
                type="button"
                onClick={() => { setHasValuables(true); setError(""); }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  hasValuables ? "border-orange-500 bg-orange-500/10" : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${hasValuables ? "text-orange-400" : "text-gray-500"}`} />
                <span className="text-sm font-semibold text-white">Valuables declared</span>
              </button>
            </div>
            {hasValuables && (
              <textarea
                value={valuables}
                onChange={(e) => setValuables(e.target.value)}
                rows={3}
                placeholder="List them — e.g. dash cam, spare key, LKR 2,000 in the console"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
            )}
          </div>

          {/* Who is signing */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Signed by</div>
            <input
              type="text"
              value={signedByName}
              onChange={(e) => setSignedByName(e.target.value)}
              placeholder="Name of the person handing the vehicle over"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Signature pad */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Signature</div>
              <button
                type="button"
                onClick={clearPad}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white"
              >
                <Eraser className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>
            <canvas
              ref={canvasRef}
              onPointerDown={startStroke}
              onPointerMove={extendStroke}
              onPointerUp={endStroke}
              onPointerLeave={endStroke}
              onPointerCancel={endStroke}
              // touch-none keeps a finger stroke drawing instead of scrolling.
              className="w-full h-44 sm:h-56 bg-white rounded-lg touch-none cursor-crosshair"
            />
            <p className="text-xs text-gray-500">Sign with a finger or a stylus.</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/10 px-4 sm:px-6 py-3 flex-shrink-0">
        <div className="max-w-3xl mx-auto space-y-3">
          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm text-gray-300 border border-white/10 rounded-xl hover:border-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-[#F97316] hover:bg-orange-600 text-white rounded-xl transition-colors"
            >
              <Check className="w-4 h-4" />
              Confirm &amp; Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
