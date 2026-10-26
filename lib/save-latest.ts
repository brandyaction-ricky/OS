/** Drain edits made during an asynchronous save, using the newly returned version each time. */
export async function saveLatest<I,R>(read:()=>{input:I;revision:number}|null,write:(input:I)=>Promise<R>,accept:(result:R,revision:number)=>boolean):Promise<R|null>{
 for(;;){const snapshot=read();if(!snapshot)return null;const result=await write(snapshot.input);if(accept(result,snapshot.revision))return result;}
}
