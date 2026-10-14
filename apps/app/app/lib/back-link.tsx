import { ArrowLeft } from "@repo/design-system";
import Link from "next/link";
import type { ReactNode } from "react";

/** "← Stores": the way back above a page title. */
export const BackLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Link
    className="inline-flex items-center gap-[5px] font-medium text-[13px] text-muted-foreground leading-none hover:text-foreground"
    href={href}
  >
    <ArrowLeft className="size-3.5" />
    {children}
  </Link>
);
