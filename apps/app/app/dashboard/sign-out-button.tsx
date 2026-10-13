"use client";

import { signOut } from "@repo/auth/client";
import { Button, LogOut } from "@repo/design-system";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const SignOutButton = () => {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleSignOut = async () => {
    setIsPending(true);
    await signOut();
    router.push("/sign-in");
    router.refresh();
  };

  return (
    <Button
      disabled={isPending}
      onClick={handleSignOut}
      size="sm"
      type="button"
      variant="outline"
    >
      <LogOut className="h-4 w-4" />
      {isPending ? "Signing out" : "Sign out"}
    </Button>
  );
};
