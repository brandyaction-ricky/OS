"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { GenerationMode } from "@/lib/content-generation-mode";
import type { GenerationAction } from "@/lib/cost";
import { CostTag, generationAsk, useCostConfirm, useCostModels } from "./cost-notice";
import { useContentWork } from "./content-work-provider";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & { onGenerate: (mode: GenerationMode) => void; action: GenerationAction; children: ReactNode };
/** The queue runs on the requester's own AI subscription; 바로 받기 is the company's Claude, so it shows the model and the estimate first. */
export function ContentGenerationButton({ onGenerate, action, children, disabled, className = "primary-button", ...props }: Props) {
  const mode = useContentWork()?.generationMode ?? "queue", other = mode === "api" ? "queue" : "api";
  const cost = useCostConfirm(), models = useCostModels();
  const run = async (next: GenerationMode) => { if (next === "queue" || await cost.confirm({ ...generationAsk(models, action), ok: "확인하고 받기" })) onGenerate(next); };
  return <span className="generation-actions">
    <button {...props} type="button" className={className} disabled={disabled} onClick={() => void run(mode)}>{mode === "api" ? "바로 받기" : children}</button><CostTag kind={mode === "api" ? "paid" : "ai"} />
    <button type="button" className="ghost-button" disabled={disabled} onClick={() => void run(other)}>{other === "api" ? "바로 받기" : "대기열에 넣기"}</button><CostTag kind={other === "api" ? "paid" : "ai"} />
    {cost.element}
  </span>;
}
