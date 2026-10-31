// 경영지원 서류함 files (요청 4954c050, 대표 결정 2026-10-31 폴더째 올리기). The private os-company-files bucket accepts exactly these
// types up to this size (bucket rule: supabase/migrations/20261031120000_company_files_folders.sql); files go to it through signed upload URLs.
export const COMPANY_FILE_BUCKET = "os-company-files";
export const COMPANY_FILE_MAX_BYTES = 500 * 1024 * 1024;
export const COMPANY_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  csv: "text/csv", txt: "text/plain", zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint",
  hwp: "application/x-hwp", hwpx: "application/hwp+zip",
};
// Anything else in a project folder is kept too, stored as .bin and only ever handed back as a download under its own name.
export const COMPANY_FILE_OTHER = { extension: "bin", mimeType: "application/octet-stream" };
export const COMPANY_FILE_PATH = new RegExp(`^finance/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]+\\.(${[...Object.keys(COMPANY_FILE_TYPES), COMPANY_FILE_OTHER.extension].join("|")})$`);

export function companyFileType(name: string) {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return COMPANY_FILE_TYPES[extension] ? { extension, mimeType: COMPANY_FILE_TYPES[extension] } : COMPANY_FILE_OTHER;
}
// Opened in a browser tab; every other stored file is downloaded under its original name.
export const companyFileViewable = (path: string) => /\.(pdf|jpg|jpeg|png|webp|gif)$/.test(path);

// The sub-folders directly under folderPath ("" = the top) among stored folder paths, in Korean order.
export function subfoldersAt(paths: string[], folderPath: string) {
  const inside = folderPath ? `${folderPath}/` : "";
  return [...new Set(paths.filter(path => path.startsWith(inside) && path !== folderPath).map(path => path.slice(inside.length).split("/")[0]))]
    .sort((left, right) => left.localeCompare(right, "ko"));
}
// Same place, name and size = already uploaded, so choosing the same folder again after a break sends only what is missing.
export const companyFileKey = (folderPath: string, name: string, size: unknown) => `${folderPath}/${name}:${size}`;
