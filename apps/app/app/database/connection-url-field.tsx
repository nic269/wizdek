"use client";

import { Button, Input } from "@repo/design-system";
import { Label } from "@repo/design-system/components/ui/label";
import { useId, useState } from "react";
import { isLocalHostUrl, unsupportedScheme } from "./database-labels";

/**
 * A masked field for a connection URL, with early hints about URLs that will
 * not work. The server stays the authority on whether a URL is usable.
 */
export function ConnectionUrlField({
  onChange,
  placeholder = "postgresql://user:password@host:5432/database",
  required = true,
  value,
}: {
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  const id = useId();
  const [isVisible, setIsVisible] = useState(false);
  const scheme = unsupportedScheme(value);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Connection URL</Label>
      <div className="flex gap-2">
        <Input
          autoComplete="off"
          className="font-mono"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          spellCheck={false}
          type={isVisible ? "text" : "password"}
          value={value}
        />
        <Button
          aria-pressed={isVisible}
          onClick={() => setIsVisible(!isVisible)}
          type="button"
          variant="outline"
        >
          {isVisible ? "Hide" : "Show"}
        </Button>
      </div>
      {scheme ? (
        <p className="text-destructive text-sm">
          {scheme} databases are not supported yet. Only PostgreSQL URLs
          (postgresql:// or postgres://) can be used.
        </p>
      ) : null}
      {isLocalHostUrl(value) ? (
        <p className="text-muted-foreground text-sm">
          This URL points at localhost, which means the machine the toolkit's
          API runs on. It works when the API runs on your computer and the
          database, or a tunnel to it, is there too. A deployed toolkit cannot
          reach your computer.
        </p>
      ) : null}
    </div>
  );
}
