"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { findPage } from "@/lib/navigation";
export function PageTitle() {
  return <h1>{findPage(`${usePathname()}?${useSearchParams().toString()}`).label}</h1>;
}
