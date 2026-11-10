export type WarehouseFormatId = "M01" | "A04" | "A10" | "D12" | "M09";
export type FormatTestCopy = Readonly<{brand: string; headline: string; support: string; cta: string}>;
export const FORMAT_TEST_FORMATS: ReadonlyArray<Readonly<{id: WarehouseFormatId; label: string}>>;
export function renderFormatTestSvg(options: {formatId: WarehouseFormatId; copy: FormatTestCopy; photo: string; fontData: string; design?: import("./safe-artwork.mjs").RenderDesign; displayFontData?: string}): string;
