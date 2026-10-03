"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { findPage } from "@/lib/navigation";
import { useWorkspaceSection } from "./workspace-section";
import {PageGuide} from "./page-guide";
export function PageTitle() {
  const title=findPage(`${usePathname()}?${useSearchParams().toString()}`).label;
  const section=useWorkspaceSection();
  return section ? <h2>{section}</h2> : <><h1>{title}</h1><PageGuide /></>;
}
