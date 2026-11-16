"use client";

import { signOut } from "@repo/auth/client";
import {
  Button,
  Ellipsis,
  initialsOf,
  LogOut,
  Settings,
  toast,
} from "@repo/design-system";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/design-system/components/ui/dropdown-menu";
import Link from "next/link";
import { useState } from "react";

/** The signed-in person at the foot of the sidebar, with settings and sign out. */
export const AccountMenu = ({
  email,
  name,
}: {
  email: string;
  name: string;
}) => {
  const [isPending, setIsPending] = useState(false);

  const handleSignOut = async () => {
    setIsPending(true);
    try {
      const result = await signOut();
      if (result.error) {
        throw new Error(result.error.message);
      }
      // A full navigation drops every cached query of the signed-out user.
      window.location.assign("/sign-in");
    } catch {
      setIsPending(false);
      toast.error("Could not sign out", { description: "Try again." });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Open account menu for ${name}`}
            className="h-auto w-full justify-start in-data-[collapsed=true]:justify-center gap-2.5 rounded-lg in-data-[collapsed=true]:p-1.5 px-2 py-1.5 text-left font-normal text-sidebar-foreground hover:bg-sidebar-hover aria-expanded:bg-sidebar-hover"
            variant="ghost"
          />
        }
      >
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-full bg-[#dfe7f6] font-semibold text-(--status-info-fg) text-[11px]"
        >
          {initialsOf(name)}
        </span>
        <span className="in-data-[collapsed=true]:hidden min-w-0 flex-1 truncate text-[13px] text-foreground-2">
          {name}
        </span>
        <Ellipsis className="in-data-[collapsed=true]:hidden size-3.5 text-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[230px] p-1.5"
        side="top"
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate p-2 font-normal text-muted-foreground text-xs">
            {email}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem
          className="gap-[9px] px-2 py-[7px] font-medium text-[13px]"
          render={<Link href="/settings" />}
        >
          <Settings className="size-[15px]" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-[9px] px-2 py-[7px] font-medium text-[13px]"
          disabled={isPending}
          onClick={handleSignOut}
        >
          <LogOut className="size-[15px]" />
          {isPending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
