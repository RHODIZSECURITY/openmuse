import type { Workspace } from "../../../packages/domain/src";

type Runtime = Workspace["runtime"];

export const RHODIZ_PC_TABS = ["Browser", "Terminal", "Files"] as const;
export type RhodizPcTab = (typeof RHODIZ_PC_TABS)[number];

export function isRhodizPc(runtime: Runtime): boolean {
  return runtime.computerBackend === "rhodiz";
}

export function rhodizPcWorkspaceConnected(runtime: Runtime): boolean {
  return isRhodizPc(runtime) && runtime.computerStatus === "connected";
}

export function rhodizPcTabs(runtime: Runtime): readonly RhodizPcTab[] {
  return isRhodizPc(runtime) && !rhodizPcWorkspaceConnected(runtime)
    ? (["Browser"] as const)
    : RHODIZ_PC_TABS;
}
