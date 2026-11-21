"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  ErrorAlert,
  Input,
  SecretInput,
  Trash2,
  toast,
} from "@repo/design-system";
import { ENV_VAR_LIMITS, envVarNameProblem } from "@repo/functions/definition";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field } from "../../lib/form-parts";
import { formatRelative } from "../../lib/format";

const envVarsKey = (functionId: string) =>
  ["function-env-vars", functionId] as const;

/**
 * A function's variables: names only, since values are write-only. Runs
 * read them from their environment.
 */
export function VariablesTab({
  canManage,
  functionId,
}: {
  canManage: boolean;
  functionId: string;
}) {
  const queryClient = useQueryClient();
  const variables = useQuery({
    queryFn: async () =>
      (await apiClient.functions.listEnvVars({ functionId })).data,
    queryKey: envVarsKey(functionId),
  });
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: envVarsKey(functionId) });
  const nameProblem = name ? envVarNameProblem(name) : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.functions.setEnvVar({ functionId, name, value });
      toast.success("Variable saved", { description: name });
      setName("");
      setValue("");
      await refresh();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the variable."));
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (variable: string) => {
    setRemoving(variable);
    try {
      await apiClient.functions.deleteEnvVar({ functionId, name: variable });
      toast.success("Variable deleted", { description: variable });
      await refresh();
    } catch (cause) {
      toast.error("Could not delete the variable", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <p className="text-[12.5px] text-muted-foreground">
        Runs read these from their environment, e.g.{" "}
        <code className="font-mono">process.env.API_KEY</code> or{" "}
        <code className="font-mono">os.environ["API_KEY"]</code>. Values are
        stored encrypted, never shown again, and replaced with{" "}
        <code className="font-mono">[redacted]</code> in stored output.
      </p>
      {variables.error ? (
        <ErrorAlert
          message={getApiErrorMessage(
            variables.error,
            "Could not load the variables."
          )}
          title="Not loaded."
        />
      ) : null}
      {variables.data && variables.data.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {variables.data.map((variable) => (
            <li
              className="flex items-center justify-between gap-2 px-3 py-2"
              data-testid="env-var"
              key={variable.name}
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[12.5px]">
                  {variable.name}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  Set {formatRelative(variable.updatedAt)}
                </p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    onClick={() => setName(variable.name)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Replace
                  </Button>
                  <Button
                    aria-label={`Delete ${variable.name}`}
                    disabled={removing === variable.name}
                    onClick={() => remove(variable.name)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {variables.data?.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No variables yet.</p>
      ) : null}
      {canManage ? (
        <form className="space-y-3" onSubmit={submit}>
          <Field
            hint={nameProblem ?? "Capital letters, digits and underscores."}
            label="Name"
          >
            <Input
              aria-label="Variable name"
              className="font-mono"
              maxLength={ENV_VAR_LIMITS.nameLength}
              onChange={(event) => setName(event.target.value.toUpperCase())}
              placeholder="API_KEY"
              value={name}
            />
          </Field>
          <Field label="Value">
            <SecretInput
              aria-label="Variable value"
              onChange={(event) => setValue(event.target.value)}
              value={value}
            />
          </Field>
          {error ? <ErrorAlert message={error} title="Not saved." /> : null}
          <Button
            disabled={isSaving || !name || !value || nameProblem !== null}
            size="sm"
            type="submit"
          >
            {isSaving ? "Saving…" : "Save variable"}
          </Button>
        </form>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          You need the <strong>Manage functions</strong> permission to change
          variables.
        </p>
      )}
    </div>
  );
}
