"use client";

import { Shimmer } from "@repo/design-system";
import dynamic from "next/dynamic";

// The canvas measures and positions nodes in the browser.
const FlowBuilder = dynamic(
  () => import("./flow-builder").then((module) => module.FlowBuilder),
  {
    loading: () => (
      <div className="flex flex-1 flex-col" role="status">
        <span className="sr-only">Loading flow</span>
        <div className="border-border border-b px-3.5 py-3.5">
          <Shimmer className="w-40" />
        </div>
        <div className="flex-1 bg-sunken" />
      </div>
    ),
    ssr: false,
  }
);

export interface FlowBuilderProps {
  /** May edit and save the flow; otherwise the canvas is read-only. */
  canManage: boolean;
  canRun: boolean;
  flowId: string;
}

export function FlowBuilderLoader(props: FlowBuilderProps) {
  return <FlowBuilder {...props} />;
}
