"use client";

import { Shimmer } from "@repo/design-system";
import dynamic from "next/dynamic";

const RunTrace = dynamic(
  () => import("./run-trace").then((module) => module.RunTrace),
  {
    loading: () => (
      <div className="flex flex-1 flex-col gap-3 p-5" role="status">
        <span className="sr-only">Loading run</span>
        <Shimmer className="w-48" />
      </div>
    ),
    ssr: false,
  }
);

export interface RunTraceProps {
  /** May cancel the run. */
  canRun: boolean;
  flowId: string;
  flowName: string;
  runId: string;
}

export function RunTraceLoader(props: RunTraceProps) {
  return <RunTrace {...props} />;
}
