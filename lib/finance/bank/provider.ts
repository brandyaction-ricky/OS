export interface BankAccount {id:string;method:"excel"|"bank_api"|"openbanking"|"aggregator"}
export interface BankTxInput {tx_date:string;deposit:number;withdrawal:number;description:string}
export interface BankProvider { id:BankAccount["method"];fetchTransactions(account:BankAccount,from:string,to:string):Promise<BankTxInput[]> }
export function bankProvider(id:BankAccount["method"]):BankProvider {
  return {id,async fetchTransactions(){throw new Error(id==="excel"?"EXCEL_IMPORT_REQUIRED":"NOT_CONFIGURED");}};
}
