import type { ImageProjectBundle, ImageProjectRow } from "./image-creative-workspace";
import { emptyImageCreative, imageExperimentSummary, type ImageCreativeState } from "@/lib/image-creative/model";
import type { AdSetup } from "@/lib/ad-production";
export const demoImageKey = "os-image-creatives-demo-v1";
function loadDemo(): ImageProjectBundle[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(demoImageKey) || "[]");
    return Array.isArray(saved) ? (saved as ImageProjectBundle[]) : [];
  } catch {
    return [];
  }
}
const projectRow = (bundle: ImageProjectBundle): ImageProjectRow => {
  const s = bundle.state,
    review = s.batches.at(-1)?.review;
  return {
    ...bundle.project,
    experiment: imageExperimentSummary(s),
    released: !!s.adRelease,
    isTest: s.isTest,
    step: review?.final
      ? 6
      : review?.preview
        ? 5
        : s.batches.length || s.formatApproval
          ? 4
          : s.formatRecommendation?.appeals?.length
            ? 3
            : 2,
  };
};
export { loadDemo as loadDemoImages, projectRow as demoImageRow };
export function saveNewDemoAd(
  title: string,
  brief: ImageCreativeState["brief"],
  adSetup: AdSetup,
  isTest: boolean,
) {
  const bundle: ImageProjectBundle = {
    project: { id: crypto.randomUUID(), title, version: 1, updatedAt: new Date().toISOString() },
    state: {
      ...emptyImageCreative(),
      brief,
      isTest,
      adSetup,
      formatRecommendation: { mode: "standalone", count: 1, size: "portrait", referenceFirst: true },
    },
    assets: [],
    jobs: [],
  };
  localStorage.setItem(demoImageKey, JSON.stringify([bundle, ...loadDemo()]));
  return bundle;
}
