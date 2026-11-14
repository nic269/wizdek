"use client";

import { NavTabs } from "@repo/design-system";
import Link from "next/link";

/** The page tabs shared by the Stores list and the Shopify apps page. */
export const StoresTabs = ({
  appCount,
  current,
  storeCount,
}: {
  appCount?: number | undefined;
  current: "apps" | "stores";
  storeCount?: number | undefined;
}) => (
  <NavTabs
    aria-label="Stores sections"
    linkComponent={Link}
    tabs={[
      {
        count: storeCount,
        current: current === "stores",
        href: "/stores",
        key: "stores",
        label: "Stores",
      },
      {
        count: appCount,
        current: current === "apps",
        href: "/stores/apps",
        key: "apps",
        label: "Shopify apps",
      },
    ]}
    variant="page"
  />
);
