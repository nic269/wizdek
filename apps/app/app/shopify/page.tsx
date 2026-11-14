import { Boxes, ChevronRight, PageHeader } from "@repo/design-system";
import type { Metadata } from "next";
import Link from "next/link";
import { AppShellLayout } from "../app-shell-layout";

export const metadata: Metadata = { title: "Shopify" };

export default function ShopifyPage() {
  return (
    <AppShellLayout>
      <PageHeader
        description="Focused tools for everyday Shopify work. Choose a tool and a connected store to get started."
        title="Shopify"
      />
      <Link
        className="group flex max-w-xl items-start gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:bg-sunken"
        href="/shopify/metafields"
      >
        <Boxes className="size-6 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <h2 className="font-semibold text-lg">Metafields</h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Create definitions in bulk, edit their details, and delete
            definitions with control over existing values.
          </p>
          <span className="mt-4 inline-flex items-center gap-2 font-medium text-sm">
            Manage metafields <ChevronRight className="size-4" />
          </span>
        </div>
      </Link>
    </AppShellLayout>
  );
}
