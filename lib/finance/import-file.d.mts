export const IMPORT_LIMITS: { bytes: number; rows: number; columns: number; [key: string]: number };
export function parseCsv(text: string): string[][];
export function checkXlsxZip(buffer: ArrayBuffer): void;
/** .csv (UTF-8 or EUC-KR) or .xlsx (first sheet) → rows of cell text. */
export function readImportFile(file: File): Promise<string[][]>;
export const IMPORT_FIELDS: Record<string, unknown>;
export function inferMapping(headers: string[], kind: string): Record<string, unknown>;
export function importDate(value: unknown): string | null;
export const importKey: (row: Record<string, unknown>, kind: string) => string;
export function previewImport(table: string[][], mapping: Record<string, unknown>, kind: string, existing: unknown, account?: string): Record<string, unknown>;
