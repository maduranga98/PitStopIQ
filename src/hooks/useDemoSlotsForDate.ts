import { useEffect, useState } from "react";
import { query, where } from "firebase/firestore";
import { watchQuery } from "../lib/listeners";
import { demoSlotsCollection } from "../lib/leads";
import type { DemoSlotLock } from "../types/leads";

/**
 * The demo slots already claimed on `date`, live, keyed by "HH:mm" → the lead
 * holding it. Anything a caller can see here is taken for everyone else.
 */
export function useDemoSlotsForDate(date: string): Map<string, DemoSlotLock> {
  const [state, setState] = useState<{ date: string; slots: Map<string, DemoSlotLock> }>({
    date: "", slots: new Map(),
  });

  useEffect(() => {
    if (!date) return;
    return watchQuery(
      query(demoSlotsCollection(), where("date", "==", date)),
      (snap) => {
        const slots = new Map<string, DemoSlotLock>();
        for (const d of snap.docs) {
          const s = d.data() as DemoSlotLock;
          slots.set(s.time, s);
        }
        setState({ date, slots });
      },
      () => setState({ date, slots: new Map() }),
    );
  }, [date]);

  return state.date === date ? state.slots : new Map();
}
