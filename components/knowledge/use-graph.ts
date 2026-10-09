"use client";
import {useEffect, useState} from "react";
import {getKnowledgeGraph} from "@/lib/api-client";
import {buildKnowledgeGraph, type KnowledgeGraph} from "@/lib/knowledge-links";
import {useKnowledge} from "./provider";
import {withIgnoredLinks} from "@/lib/knowledge/ignored-links";

/** Counts and backlinks use the same ACL-filtered graph as the connection screen. */
export function useWorkspaceGraph() {
  const {state, demo, token, loading} = useKnowledge();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (loading) return;
    let live = true;
    if (demo) { setGraph(withIgnoredLinks(buildKnowledgeGraph(state.documents),state.events)); setError(""); }
    else void getKnowledgeGraph(token).then(value => {
      if (live) { setGraph(value); setError(""); }
    }).catch(() => { if (live) { setGraph(null); setError("문서 연결을 불러오지 못했습니다"); } });
    return () => { live = false; };
  }, [state.documents, state.events, demo, token, loading]);
  return {graph, error};
}
