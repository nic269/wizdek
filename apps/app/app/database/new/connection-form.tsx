"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  ErrorState,
  Input,
  LoadingState,
} from "@repo/design-system";
import { Label } from "@repo/design-system/components/ui/label";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { useActiveOrganization } from "../../lib/active-organization";
import { ConnectionUrlField } from "../connection-url-field";

export function ConnectionForm() {
  const router = useRouter();
  const {
    error: organizationError,
    isLoading,
    organization,
  } = useActiveOrganization();
  const nameId = useId();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (organizationError) {
    return <ErrorState message={organizationError} />;
  }
  if (isLoading || !organization) {
    return <LoadingState label="Loading organization" />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { data } = await apiClient.databaseConnections.create({
        name,
        organizationId: organization.id,
        url,
      });
      setUrl("");
      router.push(`/database/${data.id}`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the connection."));
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardContent className="pt-6">
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="EVISU production"
              required
              value={name}
            />
          </div>
          <ConnectionUrlField onChange={setUrl} value={url} />
          <p className="text-muted-foreground text-sm">
            Saving connects to the database once to check the URL. Parameters
            other than <code>sslmode</code>, such as <code>schema</code>, are
            ignored.
          </p>
          {error ? <ErrorState message={error} /> : null}
          <div className="flex gap-2">
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Checking connection..." : "Save connection"}
            </Button>
            <a
              className={buttonVariants({ variant: "ghost" })}
              href="/database"
            >
              Cancel
            </a>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
