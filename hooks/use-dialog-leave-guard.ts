"use client";
import { useEffect, useRef } from "react";

// Keep an unfinished modal mounted while a user reviews a navigation request.
export function useDialogLeaveGuard(active: boolean, requestClose: () => void) {
  const destination = useRef<string | null>(null);
  const bypass = useRef(false);
  const close = useRef(requestClose);
  close.current = requestClose;
  useEffect(() => {
    if (!active) { destination.current = null; return; }
    const request = (url: string) => {destination.current = url;close.current();};
    const warn = (event: BeforeUnloadEvent) => {if (!bypass.current) {event.preventDefault();event.returnValue="";}};
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>("a[href]");
      if (event.defaultPrevented || !anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === location.href) return;
      event.preventDefault(); event.stopImmediatePropagation(); request(anchor.href);
    };
    const navigation = (window as Window & {navigation?: EventTarget}).navigation;
    const navigate = (event: Event) => {
      const traversal = event as Event & {navigationType:string;destination:{url:string}};
      if (bypass.current || event.defaultPrevented || !event.cancelable || !["traverse","reload"].includes(traversal.navigationType)) return;
      event.preventDefault(); request(traversal.destination.url);
    };
    const route = location.href, state = history.state;
    const pop = (event: PopStateEvent) => {const next=location.href;event.stopImmediatePropagation();history.pushState(state,"",route);request(next);};
    window.addEventListener("beforeunload",warn); document.addEventListener("click",click,true); navigation?.addEventListener("navigate",navigate);
    if (!navigation) window.addEventListener("popstate",pop,true);
    return () => {window.removeEventListener("beforeunload",warn);document.removeEventListener("click",click,true);navigation?.removeEventListener("navigate",navigate);window.removeEventListener("popstate",pop,true);};
  },[active]);
  return {
    cancelLeave: () => {destination.current=null;},
    confirmLeave: (closeModal: () => void) => {const url=destination.current;if(url){bypass.current=true;window.location.assign(url);}else closeModal();},
  };
}
