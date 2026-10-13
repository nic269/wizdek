"use client";

import { LoadingState } from "@repo/design-system";
import dynamic from "next/dynamic";

// The canvas measures and positions nodes in the browser.
const FlowBuilder = dynamic(
  () => import("./flow-builder").then((module) => module.FlowBuilder),
  { loading: () => <LoadingState label="Loading flow" />, ssr: false }
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
