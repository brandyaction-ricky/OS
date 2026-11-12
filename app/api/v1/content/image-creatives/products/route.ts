import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readImageAdProducts } from "@/lib/server/image-ad-products";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const products = await readImageAdProducts(await authenticateRequest(request));
    return Response.json({products}, {headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return apiErrorResponse(error); }
}
