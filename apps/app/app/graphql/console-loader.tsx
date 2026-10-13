"use client";

import { LoadingState } from "@repo/design-system";
import dynamic from "next/dynamic";

// GraphiQL edits with Monaco, which needs the browser; it is never rendered
// on the server.
const GraphqlConsole = dynamic(
  () => import("./graphql-console").then((module) => module.GraphqlConsole),
  { loading: () => <LoadingState label="Loading console" />, ssr: false }
);

export function ConsoleLoader({ userId }: { userId: string }) {
  return <GraphqlConsole userId={userId} />;
}
