import { isDemoMode } from "@/lib/config";
import examples from "@/lib/image-creative/warehouse-formats.json";

export const dynamic = "force-dynamic";
export function GET() {
  if (!isDemoMode() || process.env.IMAGE_AD_LIVE_CANON === "1") {
    return new Response(null, {status: 404});
  }
  const entries = examples.entries.map(row => ({...row, documentId: "", version: 0}));
  return Response.json({entries}, {headers: {"Cache-Control": "private, no-store"}});
}
