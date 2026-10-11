"use client";
import { useCallback, useEffect, useState } from "react";
import { isStringArray, newVaultFolder, readVaultStorage, writeVaultStorage } from "@/lib/knowledge-vault-interactions";

export function useVaultFolders(account: string | undefined, enabled: boolean) {
  const key = `brandy-vault-v2-pending-folders:${account ?? "anonymous"}`;
  const [state, setState] = useState<{ key: string; paths: string[] }>({ key: "", paths: [] });
  const paths = state.key === key ? state.paths : [];
  useEffect(() => { if (enabled && account) setState({ key, paths: readVaultStorage(key, [], isStringArray) }); }, [account, enabled, key]);
  const update = useCallback((change: (current: string[]) => string[]) => {
    setState(current => {
      const next = change(current.key === key ? current.paths : []);
      writeVaultStorage(key, next);
      return { key, paths: next };
    });
  }, [key]);
  const create = (parent: string, name: string, existing: string[]) => {
    const path = newVaultFolder(parent, name, [...existing, ...paths]);
    update(current => [...new Set([...current, path])]); return path;
  };
  const materialize = (path: string) => update(current => current.filter(item => item !== path && !path.startsWith(`${item}/`)));
  const remove = (path: string) => update(current => current.filter(item => item !== path && !item.startsWith(`${path}/`)));
  const rename = (path: string, destination: string) => update(current => [...new Set(current.map(item => item === path || item.startsWith(`${path}/`) ? destination + item.slice(path.length) : item))]);
  return { paths, create, materialize, remove, rename };
}
