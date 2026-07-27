import { Banknote, Clock, FileText, Landmark } from "lucide-react";
import type { SupplierPaymentMethod } from "../../types/auth";

// How each way of paying a supplier is drawn. Kept apart from the modal so
// both the modal and the delivery list can read it without importing a
// component from one another.

export const SUPPLIER_METHOD_ICON: Record<SupplierPaymentMethod, typeof Banknote> = {
  cash:          Banknote,
  bank_transfer: Landmark,
  cheque:        FileText,
  credit:        Clock,
};

export const SUPPLIER_METHOD_TONE: Record<SupplierPaymentMethod, string> = {
  cash:          "text-green-400",
  bank_transfer: "text-violet-400",
  cheque:        "text-blue-400",
  credit:        "text-amber-400",
};
