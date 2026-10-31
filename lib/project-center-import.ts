export function allowedProjectCenterOrigin(origin: string, development = false) {
  return origin === "https://project-center.vercel.app" || (development && origin === "http://127.0.0.1:4181");
}
export type ProjectCenterDocument = { type: "pc-document"; nonce: string; id: string; title: string; content: string; revision: string };
export function parseProjectCenterDocument(value: unknown, nonce: string): ProjectCenterDocument | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== "string" || typeof data.revision !== "string") return null;
  if (data.type !== "pc-document" || data.nonce !== nonce || !/^[a-zA-Z0-9-]{1,80}$/.test(String(data.id)) || !/^[a-f0-9]{64}$/.test(String(data.revision))) return null;
  if (typeof data.title !== "string" || !data.title.trim() || data.title.length > 200 || typeof data.content !== "string" || data.content.length > 1_500_000) return null;
  return data as ProjectCenterDocument;
}
