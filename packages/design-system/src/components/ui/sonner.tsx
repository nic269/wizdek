"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ theme: themeProp, ...props }: ToasterProps) => {
  const { theme } = useTheme();
  const resolvedTheme =
    themeProp ??
    (theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system");

  return (
    <Sonner
      className="toaster group"
      icons={{
        error: <OctagonXIcon className="size-4 text-(--toast-error)" />,
        info: <InfoIcon className="size-4 text-(--toast-info)" />,
        loading: (
          <Loader2Icon className="size-4 animate-spin text-(--toast-info)" />
        ),
        success: <CircleCheckIcon className="size-4 text-(--toast-success)" />,
        warning: (
          <TriangleAlertIcon className="size-4 text-(--toast-warning)" />
        ),
      }}
      position="bottom-right"
      style={
        {
          "--border-radius": "10px",
          "--normal-bg": "var(--toast-bg)",
          "--normal-border": "var(--toast-bg)",
          "--normal-text": "var(--toast-fg)",
        } as React.CSSProperties
      }
      theme={resolvedTheme}
      toastOptions={{
        classNames: {
          description: "!text-(--toast-muted)",
          title: "!font-semibold",
          toast:
            "cn-toast !min-w-[280px] !max-w-[380px] !px-3.5 !py-3 !font-sans !text-[13px] !leading-[1.45] !shadow-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
