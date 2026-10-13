"use client";

import { useGraphiQL } from "@graphiql/react";
import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { Button, Input } from "@repo/design-system";
import type { GraphiQLProps } from "graphiql";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Plugin = NonNullable<GraphiQLProps["plugins"]>[number];

type SavedQuery = Awaited<
  ReturnType<typeof apiClient.savedQueries.list>
>["data"][number];

function SavedQueriesIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="1em"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="1em"
    >
      <title>Saved queries</title>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function SavedQueriesPanel({ organizationId }: { organizationId: string }) {
  const queryEditor = useGraphiQL((state) => state.queryEditor);
  const variableEditor = useGraphiQL((state) => state.variableEditor);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await apiClient.savedQueries.list({ organizationId });
    setSavedQueries(data);
  }, [organizationId]);

  const attempt = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, fallback));
    }
  };

  useEffect(() => {
    load().catch((cause: unknown) =>
      setError(getApiErrorMessage(cause, "Could not load saved queries."))
    );
  }, [load]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = queryEditor?.getValue() ?? "";
    const variables = variableEditor?.getValue() ?? "";
    if (!query.trim()) {
      setError("Write a query before saving it.");
      return;
    }
    return attempt(async () => {
      await apiClient.savedQueries.create({
        name,
        organizationId,
        query,
        ...(variables.trim() ? { variables } : {}),
      });
      setName("");
    }, "Could not save the query.");
  };

  const rename = (event: FormEvent<HTMLFormElement>, savedQueryId: string) => {
    event.preventDefault();
    return attempt(async () => {
      await apiClient.savedQueries.update({
        name: newName,
        organizationId,
        savedQueryId,
      });
      setRenamingId(null);
    }, "Could not rename the query.");
  };

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="font-semibold text-lg">Saved queries</h2>
        <p className="text-muted-foreground text-xs">
          Shared with everyone in this organization.
        </p>
      </div>
      <form className="flex gap-2" onSubmit={save}>
        <Input
          aria-label="Saved query name"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name for the current query"
          required
          value={name}
        />
        <Button size="sm" type="submit">
          Save
        </Button>
      </form>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {savedQueries.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing saved yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {savedQueries.map((savedQuery) => (
            <li className="space-y-2 px-3 py-2" key={savedQuery.id}>
              {renamingId === savedQuery.id ? (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => rename(event, savedQuery.id)}
                >
                  <Input
                    aria-label="New name"
                    maxLength={120}
                    onChange={(event) => setNewName(event.target.value)}
                    required
                    value={newName}
                  />
                  <Button size="sm" type="submit">
                    Rename
                  </Button>
                </form>
              ) : (
                <p className="truncate font-medium" title={savedQuery.name}>
                  {savedQuery.name}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    queryEditor?.setValue(savedQuery.query);
                    variableEditor?.setValue(savedQuery.variables ?? "");
                  }}
                  size="sm"
                  variant="outline"
                >
                  Load
                </Button>
                <Button
                  onClick={() => {
                    setRenamingId(
                      renamingId === savedQuery.id ? null : savedQuery.id
                    );
                    setNewName(savedQuery.name);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {renamingId === savedQuery.id ? "Cancel" : "Rename"}
                </Button>
                <Button
                  onClick={() =>
                    attempt(
                      () =>
                        apiClient.savedQueries.delete({
                          organizationId,
                          savedQueryId: savedQuery.id,
                        }),
                      "Could not delete the query."
                    )
                  }
                  size="sm"
                  variant="ghost"
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A GraphiQL sidebar plugin listing the organization's shared queries. */
export const createSavedQueriesPlugin = (organizationId: string): Plugin => ({
  content: () => <SavedQueriesPanel organizationId={organizationId} />,
  icon: SavedQueriesIcon,
  title: "Saved queries",
});
