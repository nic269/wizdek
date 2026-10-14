"use client";

import { Button, Eye, Lock } from "@repo/design-system";
import { FieldLabel } from "@repo/design-system/components/ui/field";
import { Input } from "@repo/design-system/components/ui/input";
import { useId, useState } from "react";
import { isLocalHostUrl, unsupportedScheme } from "./database-labels";

/**
 * A write-only field for a connection URL, with early hints about URLs that
 * will not work. The server stays the authority on whether a URL is usable.
 */
export function ConnectionUrlField({
  hint = "Secret. Stored encrypted and never shown again. A read-only user is enough for backups.",
  label = "Database URL",
  onChange,
  placeholder = "postgres://user:password@host:5432/db",
  required = true,
  value,
}: {
  hint?: string;
  label?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  const id = useId();
  const [isVisible, setIsVisible] = useState(false);
  const scheme = unsupportedScheme(value);

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Lock className="pointer-events-none absolute top-[10px] left-2.5 size-3.5 text-muted-foreground" />
          <Input
            autoComplete="off"
            className="pl-[30px] font-mono text-[13px]"
            id={id}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            required={required}
            spellCheck={false}
            type={isVisible ? "text" : "password"}
            value={value}
          />
        </div>
        <Button
          aria-label={isVisible ? "Hide URL" : "Show URL"}
          aria-pressed={isVisible}
          onClick={() => setIsVisible(!isVisible)}
          size="icon"
          title={isVisible ? "Hide" : "Show"}
          type="button"
          variant="outline"
        >
          <Eye />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs leading-[1.4]">{hint}</p>
      {scheme ? (
        <p className="text-(--status-danger-fg) text-xs leading-[1.4]">
          {scheme} databases are not supported yet. Only PostgreSQL URLs
          (postgresql:// or postgres://) can be used.
        </p>
      ) : null}
      {isLocalHostUrl(value) ? (
        <p className="text-muted-foreground text-xs leading-[1.4]">
          This URL points at localhost, which means the machine wizdek's API
          runs on. It works when the API runs on your computer and the database,
          or a tunnel to it, is there too. A deployed wizdek cannot reach your
          computer.
        </p>
      ) : null}
    </div>
  );
}
