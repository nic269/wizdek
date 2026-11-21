import { EmptyState, InlineAlert, SquareCode } from "@repo/design-system";

/** Shown while the server has no runner configured. */
export const FunctionsNotEnabled = () => (
  <EmptyState
    description="Functions run on a separate runner server, and this Wizdek server has none configured. Ask whoever runs Wizdek to set the runner address and token."
    icon={<SquareCode />}
    title="Functions are not enabled"
  />
);

/** Shown while the runner is configured but does not answer. */
export const RunnerUnreachable = () => (
  <InlineAlert title="The runner is not answering." tone="warning">
    You can still edit functions; runs will fail until it is back.
  </InlineAlert>
);
