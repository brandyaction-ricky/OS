"use client";

import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { SessionProfile } from "@/lib/types";

interface SessionContextValue {
  loading: boolean;
  demo: boolean;
  session: Session | null;
  profile: SessionProfile | null;
  accessToken: string | null;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const demoProfile: SessionProfile = {
  id: "demo-ricky",
  email: "ricky@brandyaction.com",
  displayName: "리키",
  role: "admin",
  team: "경영",
  mustChangePassword: false,
};

function clientIsDemo() {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const demo = clientIsDemo();
  const [loading, setLoading] = useState(!demo);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<SessionProfile | null>(demo ? demoProfile : null);

  useEffect(() => {
    if (demo) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const client = supabase;
    let active = true;
    let generation = 0;
    let currentUserId: string | null = null;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function hydrate(nextSession: Session, requestGeneration: number, controller: AbortController) {
      const { data } = await client
        .from("os_profiles")
        .select("id,email,display_name,role,team,must_change_password")
        .eq("id", nextSession.user.id)
        .abortSignal(controller.signal)
        .maybeSingle();

      // A sign-out, account switch, or newer auth event invalidates this response.
      if (!active || controller.signal.aborted || requestGeneration !== generation) return;
      setProfile({
        id: nextSession.user.id,
        email: data?.email ?? nextSession.user.email ?? "",
        displayName:
          data?.display_name ??
          nextSession.user.user_metadata?.display_name ??
          nextSession.user.email?.split("@")[0] ??
          "구성원",
        role: data?.role ?? "member",
        team: data?.team ?? "전체",
        mustChangePassword: Boolean(data?.must_change_password),
      });
      setLoading(false);
    }

    // INITIAL_SESSION already supplies the stored session. A second getSession()
    // causes a duplicate profile read, and re-subscribing on navigation repeats it.
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      const requestGeneration = ++generation;
      request?.abort();
      clearTimeout(timer);
      setSession(nextSession);
      const nextUserId = nextSession?.user.id ?? null;
      if (nextUserId !== currentUserId || !nextSession) {
        setProfile(null);
        setLoading(Boolean(nextSession));
      }
      currentUserId = nextUserId;
      if (!nextSession) return;

      const controller = new AbortController();
      request = controller;
      // Keep database work outside the synchronous auth callback/lock. This also
      // coalesces auth events arriving together into one profile request.
      timer = setTimeout(() => { void hydrate(nextSession, requestGeneration, controller); }, 0);
    });
    return () => {
      active = false;
      generation += 1;
      clearTimeout(timer);
      request?.abort();
      listener.subscription.unsubscribe();
    };
  }, [demo]);

  useEffect(() => {
    if (demo || loading || session) return;
    const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`);
  }, [demo, loading, pathname, router, session]);

  const value = useMemo<SessionContextValue>(
    () => ({
      loading,
      demo,
      session,
      profile,
      accessToken: session?.access_token ?? null,
      signOut: async () => {
        if (demo) return;
        await getBrowserSupabase()?.auth.signOut();
        router.replace("/login");
      },
    }),
    [demo, loading, profile, router, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
