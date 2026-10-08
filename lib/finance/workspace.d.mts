import type { WorkspaceData } from "./ledger-adapter.mjs";
export interface FinanceController {
  setUrl(url: string): void;
  destroy(): void;
}
export interface FinanceWorkspaceOptions {
  url: string;
  navigate(url: string): void;
  replaceUrl(url: string): void;
  onReset(): void;
  data?: WorkspaceData;
  actorId?: string;
  today?: string;
  dataStart?: string;
  onChange?(before: WorkspaceData, after: WorkspaceData): Promise<WorkspaceData>;
  command?(command:string,input?:Record<string,unknown>,file?:File):Promise<WorkspaceData>;
  importRows?(kind:string,rows:Record<string,unknown>[],cards:Record<string,unknown>[],metadata:Record<string,unknown>):Promise<WorkspaceData>;
  findMapping?(headers:string[],kind:string):Promise<Record<string,number>|undefined>;
}
export function mountFinanceWorkspace(
  root: HTMLElement,
  options: FinanceWorkspaceOptions,
): FinanceController;
