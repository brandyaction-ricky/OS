"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "./session-provider";
import type { CreativeVariant } from "@/lib/image-creative/model";
import { resolvePlacement } from "@/lib/image-creative/placement";
import { readWarehousePhoto } from "@/lib/image-creative/warehouse-output";

interface Props {
  projectId: string;
  variant: CreativeVariant;
  assetUrl?: string;
  baseId?: string;
  onReady?: (png: Blob | null) => void;
  onCheck?: (problems: string[]) => void;
}

export function LegacySavedPng({ projectId, variant, assetUrl, baseId, onReady, onCheck }: Props) {
  const { demo, accessToken } = useSession();
  const report = useRef({ onReady, onCheck });
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  const placement = resolvePlacement(variant.size, variant.design?.placement, variant.design?.outputWidth);
  useEffect(() => { report.current = { onReady, onCheck }; }, [onReady,onCheck]);
  // Stabilize unsaved form objects while React re-renders for the PNG readiness callback.
  const body = JSON.stringify(demo ? { variant } : { variantId: baseId || variant.id, design: variant.design });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl(""); setProblem(""); report.current.onReady?.(null); report.current.onCheck?.(["PNG를 준비 중입니다."]);
    void (async () => {
      const payload = JSON.parse(body);
      if (demo && assetUrl) payload.photo = await readWarehousePhoto(assetUrl);
      const response = await fetch("/api/v1/content/image-creatives/" + encodeURIComponent(demo ? "demo" : projectId) + "/preview", {
        method: "POST", headers: { "content-type":"application/json", ...(accessToken ? { authorization:"Bearer "+accessToken } : {}) },
        body: JSON.stringify(payload), signal: controller.signal, cache: "no-store",
      });
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new Error(details?.error?.message || "시안의 PNG를 불러오지 못했어요.");
      }
      const blob = await response.blob();
      if (blob.type !== "image/png" || !blob.size) throw new Error("PNG 파일을 확인해 주세요.");
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl); report.current.onReady?.(blob); report.current.onCheck?.([]);
    })().catch(error => {
      if (controller.signal.aborted) return;
      const message=error instanceof Error ? error.message : "PNG를 만들 수 없어요.";
      setProblem(message); report.current.onCheck?.([message]);
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); report.current.onReady?.(null); };
  },[body, assetUrl, projectId, demo, accessToken]);
  return <div className="ic-preview" data-size={placement.size}>
    {url ? (
      // eslint-disable-next-line @next/next/no-img-element -- preview and download use the same actual PNG
      <img src={url} alt={variant.copy.headline} width={placement.width} height={placement.height} className="ic-preview-png" />
    ) : <span role="status">{problem || "시안을 만드는 중입니다."}</span>}
  </div>;
}
