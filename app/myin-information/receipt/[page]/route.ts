import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { receiptDraft } from "@/lib/cardnews/examples/receipt";
import { CardSlideView } from "@/lib/cardnews/card-slide";
import { CARD_SIZE } from "@/lib/cardnews/formats";

export async function GET(_request: Request, { params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (process.env.VERCEL_ENV === "production" || !/^[1-6]$/.test(page)) return new Response(null, { status: 404 });
  const image = await readFile(join(process.cwd(), "lib/cardnews/examples/receipt", page + ".jpg"));
  const fonts = await Promise.all(([400, 500, 600] as const).map(async weight => ({
    name: "Pretendard", weight, data: await readFile(join(process.cwd(), "lib/cardnews/fonts", "Pretendard-" + weight + ".woff"))
  })));
  return new ImageResponse(createElement(CardSlideView, { draft: receiptDraft, index: Number(page) - 1,
    photos: { [page]: "data:image/jpeg;base64," + image.toString("base64") } }), { ...CARD_SIZE, fonts });
}
