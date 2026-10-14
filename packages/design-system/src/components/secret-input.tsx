import type { ComponentProps, ReactNode } from "react";
import { Lock } from "../icons";
import { cn } from "../lib/cn";
import { Input } from "./ui/input";

export const SECRET_HELPER =
  "Stored encrypted. Write-only — it's never shown again, only replaced.";

/**
 * A write-only secret field: a lock, a mono password input, and a note that
 * the value is stored encrypted and never shown again.
 */
export const SecretInput = ({
  className,
  helper = SECRET_HELPER,
  helperId,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & {
  /** The note under the field; `null` hides it. */
  helper?: ReactNode | null;
  /** Id of the note, so the input can be described by it. */
  helperId?: string | undefined;
}) => (
  <div className="flex flex-col gap-1.5">
    <div className="relative">
      <Lock
        aria-hidden="true"
        className="pointer-events-none absolute top-[10px] left-2.5 size-3.5 text-muted-foreground"
      />
      <Input
        aria-describedby={helper && helperId ? helperId : undefined}
        autoComplete="off"
        className={cn("pl-[30px] font-mono text-[13px]", className)}
        spellCheck={false}
        type="password"
        {...props}
      />
    </div>
    {helper ? (
      <p className="text-muted-foreground text-xs leading-[1.4]" id={helperId}>
        {helper}
      </p>
    ) : null}
  </div>
);
