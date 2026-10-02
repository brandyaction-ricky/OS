"use client";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
export function useQueryTab<T extends string>(key:string,allowed:readonly T[],fallback:T):[T,(next:T)=>void] {
 const pathname=usePathname(), router=useRouter(), search=useSearchParams();const requested=search.get(key) as T;
 return [allowed.includes(requested)?requested:fallback,(next:T)=>{const query=new URLSearchParams(search.toString());query.set(key,next);router.push(`${pathname}?${query}`,{scroll:false});}];
}
