import { WorkspaceSkeleton } from "@/components/workspace-load-state";

// A shared loading boundary lets Next prefetch and show the destination shell
// while a dynamic page resolves. The page's own data loading remains separate.
export default function OsLoading() {
  return <WorkspaceSkeleton />;
}
