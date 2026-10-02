import { createContext, useContext } from "react";
export const Ctx = createContext<any>(null);
export function useAuth() { return useContext(Ctx); }
