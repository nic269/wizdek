import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "#lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      className={cn(
        "h-[34px] w-full min-w-0 rounded-lg border border-input bg-card px-2.5 py-1 text-[13.5px] outline-none transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-accent-soft disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:disabled:bg-input/80",
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
