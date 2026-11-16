"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import type { ImageBrief } from "@/lib/image-creative/model";
import { imageBriefMatchesProduct, type ImageAdProduct } from "@/lib/image-creative/products";
import { useSession } from "./session-provider";

type Result = {items:ImageAdProduct[];error?:string};
const readError = "최신 상품 정본을 확인하지 못했어요.";

export function useImageProductCatalog(local:boolean, preview:ImageAdProduct[]|undefined, enabled=true) {
  const {demo,accessToken} = useSession();
  const path = demo ? (local ? "/api/dev/image-ad-products" : undefined) : "/api/v1/content/image-creatives/products";
  const token = demo ? null : accessToken;
  const key = path && (demo || token) ? JSON.stringify([path,token]) : undefined;
  const [last,setLast] = useState<Result & {key:string}>();
  const pending = useRef<{key:string;controller:AbortController;read:Promise<ImageAdProduct[]>}|undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!path) return preview ?? [];
    if (!key) throw new Error(readError);
    if (pending.current?.key === key) return pending.current.read;
    const controller = new AbortController();
    const read = apiRequest<{products:ImageAdProduct[]}>(path,{token,signal:controller.signal}).then(({products})=>{
      if (!Array.isArray(products)) throw new Error(readError);
      if (!controller.signal.aborted) setLast({key,items:products});
      return products;
    }).catch(error=>{
      if (controller.signal.aborted) throw error;
      setLast(old=>({key,items:old?.key===key ? old.items : [],error:readError}));
      throw new Error(readError);
    }).finally(()=>{
      if (pending.current?.controller === controller) pending.current = undefined;
    });
    pending.current = {key,controller,read};
    return read;
  },[key,path,preview,token]);

  const loaded = Boolean(key && last?.key === key);
  useEffect(()=>{
    let active = true;
    if (enabled && key && !loaded) queueMicrotask(() => {
      if (active) void refresh().catch(()=>{});
    });
    return ()=>{
      active = false;
      pending.current?.controller.abort();
      pending.current = undefined;
    };
  },[enabled,key,loaded,refresh]);

  const result:Result|undefined = !path ? {items:preview ?? []} : key && last?.key===key ? last : undefined;
  async function verify(brief:ImageBrief) {
    if (!brief.productSource) return;
    let products = result?.error ? undefined : result?.items;
    const loading = pending.current;
    if (loading && loading.key === key) products = await loading.read;
    if (!products) throw new Error(readError);
    if (!imageBriefMatchesProduct(brief,products.find(row=>row.id===brief.productSource!.productId)))
      throw new ApiRequestError("상품 정본이 바뀌었어요. 최신 상품 정보를 확인해 주세요.","IMAGE_PRODUCT_CHANGED",409);
  }
  return {result,refresh,verify};
}

export type ImageProductCatalog = ReturnType<typeof useImageProductCatalog>;
