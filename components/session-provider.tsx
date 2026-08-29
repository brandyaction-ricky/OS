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

    async function hydrate(nextSession: Session | null) {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setLoading(false);
        const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
        router.replace(`/login${next}`);
        return;
      }

      const { data } = await client
        .from("os_profiles")
        .select("id,email,display_name,role,team")
        .eq("id", nextSession.user.id)
        .maybeSingle();

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
      });
      setLoading(false);
    }

    client.auth.getSession().then(({ data }) => hydrate(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      hydrate(nextSession);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [demo, pathname, router]);

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
