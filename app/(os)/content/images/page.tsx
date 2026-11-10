import type { Metadata } from "next";
import { ImageCreativeWorkspace } from "@/components/image-creative-workspace";

export const metadata: Metadata = { title: "이미지 광고 | 브랜디 OS" };
export default function ImageCreativePage() { return <ImageCreativeWorkspace />; }
