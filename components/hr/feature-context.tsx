"use client";
import { createContext, useContext, type ReactNode } from "react";
const HrFeatureContext = createContext(false);
export function HrFeatureProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <HrFeatureContext.Provider value={enabled}>
      {children}
    </HrFeatureContext.Provider>
  );
}
export const useHrEnabled = () => useContext(HrFeatureContext);
