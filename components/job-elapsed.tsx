"use client";
import { useEffect, useState } from "react";

export function JobElapsed({ started }: { started: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(started)) / 1000));
  return <span>{Math.floor(elapsed / 60)}분 {elapsed % 60}초 경과</span>;
}
