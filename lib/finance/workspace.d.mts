export interface FinanceController {
  setUrl(url: string): void;
  destroy(): void;
}
export interface FinanceWorkspaceOptions {
  url: string;
  navigate(url: string): void;
  replaceUrl(url: string): void;
  onReset(): void;
  onChange?(): void;
}
export function mountFinanceWorkspace(
  root: HTMLElement,
  options: FinanceWorkspaceOptions,
): FinanceController;
