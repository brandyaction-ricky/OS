"use client";
import { createContext } from "react";
import type { TopicPlatform } from "@/lib/content-platforms";

/** A loaded project supplies its platform to the breadcrumb without a second API request. */
export type ProjectLocation = { id: string; platform: TopicPlatform };
export const ProjectLocationContext = createContext<(location: ProjectLocation) => void>(() => {});
