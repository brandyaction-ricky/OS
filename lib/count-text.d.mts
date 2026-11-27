export function parseNumbers(text: string): number[];
export function countText(text: string, from: number[], t: number): string;
export function ease(t: number): number;
export const RUN_MS: number;
export function runFigures(root: ParentNode | null, selector: string, memory: Map<string, number[][]>, keyOf: (element: Element, index: number) => string): void;
