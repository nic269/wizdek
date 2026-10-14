"use client";

import { Shimmer } from "@repo/design-system";
import dynamic from "next/dynamic";

// GraphiQL edits with Monaco, which needs the browser; it is never rendered
// on the server.
const GraphqlConsole = dynamic(
  () => import("./graphql-console").then((module) => module.GraphqlConsole),
  {
    loading: () => (
      <div className="flex flex-1 flex-col gap-3 p-4" role="status">
        <span className="sr-only">Loading console</span>
        <Shimmer className="h-9 w-80" />
      </div>
    ),
    ssr: false,
  }
);

export function ConsoleLoader({ userId }: { userId: string }) {
  return <GraphqlConsole userId={userId} />;
}
