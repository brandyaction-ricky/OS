import type { ReactNode } from "react";
import type { AdAspect } from "@/lib/ad-production";
import type { CreativeSize } from "@/lib/image-creative/formats";
import { adPlacementFrame, resolvePlacement, type PlacementId } from "@/lib/image-creative/placement";

export function AdPlacementPicker({ aspects, value, select, guide, setGuide }: {
  aspects: AdAspect[]; value: AdAspect; select: (aspect: AdAspect) => void;
  guide: boolean; setGuide: (visible: boolean) => void;
}) {
  const { width, height } = adPlacementFrame(value);
  return <div className="ic-row" role="group" aria-label="게재 크기">
    {aspects.map(aspect => <button key={aspect} type="button" className="secondary-button"
      aria-pressed={aspect === value} onClick={() => select(aspect)}>{aspect.replace("x", ":")}</button>)}
    <span>{width} × {height}</span>
    {value === "9x16" && <label><input type="checkbox" checked={guide} onChange={e => setGuide(e.target.checked)}/>세이프존</label>}
  </div>;
}

/** Display the master at the same scale and position as the approved PNG export. */
export function AdPlacementPreview({ aspect, sourceSize, placement, children }: {
  aspect: AdAspect; sourceSize: CreativeSize; placement?: PlacementId; children: ReactNode;
}) {
  return <div className="ad-placement-frame" data-aspect={aspect}>
    <div className="ad-placement-safe">
      <div className="ad-placement-master" data-size={resolvePlacement(sourceSize, placement).size}>{children}</div>
    </div>
  </div>;
}
