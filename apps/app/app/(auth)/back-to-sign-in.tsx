import { ArrowLeft } from "@repo/design-system";
import Link from "next/link";

export const BackToSignIn = () => (
  <Link
    className="inline-flex items-center gap-1.5 self-start font-medium text-[13.5px] text-muted-foreground leading-none hover:text-foreground"
    href="/sign-in"
  >
    <ArrowLeft className="size-3.5" />
    Back to sign in
  </Link>
);
