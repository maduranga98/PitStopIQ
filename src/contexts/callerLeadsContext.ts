import { createContext, useContext } from "react";
import type { Lead } from "../types/leads";

/** The signed-in caller's own leads — one subscription shared by Board and Revenue. */
export interface CallerLeadsValue {
  leads: Lead[];
  loading: boolean;
  error: boolean;
}

export const CallerLeadsContext = createContext<CallerLeadsValue | null>(null);

export function useCallerLeads(): CallerLeadsValue {
  const ctx = useContext(CallerLeadsContext);
  if (!ctx) throw new Error("useCallerLeads must be used within CallerLeadsProvider");
  return ctx;
}
