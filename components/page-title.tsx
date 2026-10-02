"use client";
import { usePathname } from "next/navigation";
import { findPage } from "@/lib/navigation";
export function PageTitle() {
  return <h1>{findPage(usePathname()).label}</h1>;
}
