"use client";

import { signOut } from "@repo/auth/client";
import { Button, ChevronsUpDown, LogOut, Settings } from "@repo/design-system";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import {
  Avatar,
  AvatarFallback,
} from "@repo/design-system/components/ui/avatar";
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

const WHITESPACE_PATTERN = /\s+/;

const getInitials = (name: string) =>
  name
    .trim()
    .split(WHITESPACE_PATTERN)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");

/** Signed-in identity at the foot of the sidebar, with settings and sign out. */
export const AccountMenu = ({
  email,
  name,
}: {
  email: string;
  name: string;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSignOut = async () => {
    setError(null);
    setIsPending(true);
    try {
      const result = await signOut();
      if (result.error) {
        setError("Could not sign out. Try again.");
        setIsPending(false);
        return;
      }
      // A full navigation drops every cached query of the signed-out user.
      window.location.assign("/sign-in");
    } catch {
      setError("Could not sign out. Try again.");
      setIsPending(false);
    }
  };

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Open account menu for ${name}`}
          render={
            <Button
              className="h-12 w-full justify-start in-data-[collapsed=true]:justify-center gap-2.5 rounded-lg in-data-[collapsed=true]:px-0 px-2 text-left hover:bg-[var(--shell-hover,var(--muted))] aria-expanded:bg-[var(--shell-hover,var(--muted))]"
              variant="ghost"
            />
          }
        >
          <Avatar aria-hidden="true" className="after:border-0">
            <AvatarFallback className="bg-[var(--shell-avatar)] font-semibold text-[var(--shell-avatar-foreground)] text-xs">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="flex in-data-[collapsed=true]:hidden min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-semibold text-sm leading-tight">
              {name}
            </span>
            <span className="truncate font-normal text-muted-foreground text-xs leading-tight">
              {email}
            </span>
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="in-data-[collapsed=true]:hidden text-muted-foreground"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="product-shell w-58 rounded-[8px]"
          side="top"
          sideOffset={8}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5 px-2.5 py-2">
              <span className="truncate font-semibold text-foreground text-sm">
                {name}
              </span>
              <span className="truncate font-normal text-muted-foreground">
                {email}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-9 px-2.5"
            render={<Link href="/settings" />}
          >
            <Settings aria-hidden="true" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-9 px-2.5"
            disabled={isPending}
            onClick={handleSignOut}
          >
            <LogOut aria-hidden="true" />
            {isPending ? "Signing out" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <Alert
          className="absolute right-0 bottom-full z-50 mb-2 w-[min(15rem,calc(100vw-2rem))] bg-popover shadow-md lg:fixed lg:right-4 lg:bottom-4 lg:mb-0"
          variant="destructive"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};
