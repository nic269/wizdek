"use client";

import { LoadingState } from "@repo/design-system";
import dynamic from "next/dynamic";

const RunTrace = dynamic(
  () => import("./run-trace").then((module) => module.RunTrace),
  { loading: () => <LoadingState label="Loading run" />, ssr: false }
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
