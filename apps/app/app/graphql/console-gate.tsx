"use client";

import { buttonVariants, Lock, Shimmer } from "@repo/design-system";
import Link from "next/link";
import { useActiveOrganization } from "../lib/active-organization";
import { usePermissions } from "../lib/permissions";
import { ConsoleLoader } from "./console-loader";

/** The console needs `graphql:query`; without it a locked state says why. */
export function ConsoleGate({ userId }: { userId: string }) {
  const { organization } = useActiveOrganization();
  const { can, isLoading } = usePermissions();
  if (isLoading || !organization) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4" role="status">
        <span className="sr-only">Loading console</span>
        <Shimmer className="h-9 w-80" />
      </div>
    );
  }
  if (!can("graphql:query")) {
    return (
      <div className="grid flex-1 place-items-center px-6 py-10">
        <div className="flex max-w-[440px] flex-col items-center gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-[12px] border border-border bg-sunken text-muted-foreground">
            <Lock className="size-[21px]" />
          </div>
          <h1 className="font-semibold text-[19px] leading-[1.25] tracking-[-0.01em]">
            The GraphQL console isn't available to{" "}
            {organization.role ? `${organization.role}s` : "your role"}
          </h1>
          <p className="text-pretty text-muted-foreground text-sm leading-[1.55]">
            Running queries needs the{" "}
            <span className="rounded bg-sunken px-[5px] py-0.5 font-medium font-mono text-[12.5px] text-foreground-2">
              graphql:query
            </span>{" "}
            permission. Ask an Owner or Admin in {organization.name} to change
            your role.
          </p>
          <div className="mt-1.5 flex gap-2">
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/settings/access"
            >
              See roles
            </Link>
            <Link className={buttonVariants()} href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return <ConsoleLoader userId={userId} />;
}
