"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { GenerationMode } from "@/lib/content-generation-mode";
import { useContentWork } from "./content-work-provider";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & { onGenerate: (mode: GenerationMode) => void; children: ReactNode };
export function ContentGenerationButton({ onGenerate, children, disabled, className = "primary-button", ...props }: Props) {
  const mode = useContentWork()?.generationMode ?? "queue";
  return <span className="generation-actions">
    <button {...props} type="button" className={className} disabled={disabled} onClick={() => onGenerate(mode)}>{mode === "api" ? "바로 받기 · API" : children}</button>
    <button type="button" className="ghost-button" disabled={disabled} title={mode === "api" ? "API 비용 없이 구독 작업으로 요청합니다." : "API 비용이 발생하며 요청 즉시 생성합니다."} onClick={() => onGenerate(mode === "api" ? "queue" : "api")}>{mode === "api" ? "대기열에 넣기" : "바로 받기 · API"}</button>
  </span>;
}
