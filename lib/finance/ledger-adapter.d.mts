import type { FinanceData, FinanceRow } from './schema';
export interface WorkspaceData {DB:Record<string,unknown>;TX:unknown[];CR:unknown[];CARDS:unknown[];BANK:unknown[];ST:unknown[];PO:unknown[];settings?:Record<string,unknown>}
export function workspaceFromLedger(data:FinanceData,today:string):WorkspaceData;
export function createLedgerProjection(initial:FinanceData):{project(snapshot:WorkspaceData):FinanceData;ack(changes:Array<{resource:string;row:FinanceRow}>):void;diff(before:WorkspaceData,after:WorkspaceData):Array<{resource:string;row:FinanceRow}>};
