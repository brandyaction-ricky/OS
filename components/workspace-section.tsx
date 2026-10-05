"use client";
import {createContext,useContext,type ReactNode} from "react";
const SectionContext=createContext<string|null>(null);
export function WorkspaceSection({title,children}:{title:string;children:ReactNode}) {return <SectionContext.Provider value={title}><section className="workspace-section" aria-label={title}>{children}</section></SectionContext.Provider>;}
export function useWorkspaceSection(){return useContext(SectionContext);}
