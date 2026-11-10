"use client";
import { useEffect, useRef, useState } from "react";
import { isWarehouseFormat } from "@/lib/image-creative/formats";
import type { CreativeVariant } from "@/lib/image-creative/model";
import { resolvePlacement } from "@/lib/image-creative/placement";
import { readWarehousePhoto, warehousePng } from "@/lib/image-creative/warehouse-output";

type Props = {
  variant: CreativeVariant;
  assetUrl?: string;
  onReady?: (png: Blob | null) => void;
  onCheck?: (problems: string[]) => void;
};

export function WarehouseVariantPreview({ variant, assetUrl, onReady, onCheck }: Props) {
  const report = useRef({ onReady, onCheck });
  useEffect(() => { report.current = { onReady, onCheck }; }, [onReady, onCheck]);
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  const { formatId, formatVersion, size, brand, copy, design } = variant;
  const placement = resolvePlacement(size, design?.placement, design?.outputWidth);
  const { headline, body, cta } = copy;
  useEffect(() => {
    let live = true;
    let objectUrl = "";
    setUrl(""); setProblem("");
    report.current.onReady?.(null);
    report.current.onCheck?.(["PNG를 준비 중입니다."]);
    void (async () => {
      if (!isWarehouseFormat(formatId) || formatVersion !== 2 || !brand?.trim()) {
        throw new Error("브랜드와 포맷 버전을 확인해 주세요.");
      }
      if (!assetUrl) throw new Error("이 작업에 등록한 사진을 선택해 주세요.");
      const photo = await readWarehousePhoto(assetUrl);
      if (!live) return;
      const blob = await warehousePng(formatId, { brand, headline, support: body, cta }, photo, 2, design);
      if (!live) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      report.current.onReady?.(blob);
      report.current.onCheck?.([]);
    })().catch(err => {
      if (!live) return;
      const message = err instanceof Error ? err.message : "시안을 만들 수 없어요.";
      setProblem(message); report.current.onCheck?.([message]);
    });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); report.current.onReady?.(null); };
  }, [formatId, formatVersion, size, brand, headline, body, cta, assetUrl, design]);
  // The preview uses the exact downloadable PNG blob. Image optimization would change the output.
  return <div className="ic-preview" data-size={placement.size}>
    {url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={headline} src={url} width={placement.width} height={placement.height} className="ic-preview-png"/>)
      : <span role="status">{problem || "시안을 만드는 중입니다."}</span>}
  </div>;
}
