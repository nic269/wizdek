"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  ErrorAlert,
  Input,
  SegmentedControl,
  toast,
} from "@repo/design-system";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import {
  FUNCTION_LIMITS,
  FUNCTION_RUNTIMES,
  type FunctionRuntime,
  RUNTIME_LABELS,
} from "@repo/functions/definition";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Field } from "../lib/form-parts";

const RUNTIME_OPTIONS = FUNCTION_RUNTIMES.map((runtime) => ({
  label: RUNTIME_LABELS[runtime],
  value: runtime,
}));

/** Asks for a name and runtime, creates the function and opens it. */
export function NewFunctionDialog({
  onOpenChange,
  open,
  organizationId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<FunctionRuntime>("NODE");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setRuntime("NODE");
      setError(null);
    }
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    setError(null);
    setIsPending(true);
    try {
      const { data } = await apiClient.functions.create({
        name: name.trim(),
        organizationId,
        runtime,
      });
      toast.success("Function created", { description: data.name });
      router.push(`/functions/${data.id}`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not create the function."));
      setIsPending(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[440px]">
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New function</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name">
              <Input
                aria-label="Function name"
                autoFocus
                maxLength={FUNCTION_LIMITS.nameLength}
                onChange={(event) => setName(event.target.value)}
                placeholder="Export unfulfilled orders"
                required
                value={name}
              />
            </Field>
            <Field label="Runtime">
              <SegmentedControl
                aria-label="Runtime"
                onValueChange={setRuntime}
                options={RUNTIME_OPTIONS}
                value={runtime}
              />
            </Field>
            {error ? <ErrorAlert message={error} title="Not created." /> : null}
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isPending || !name.trim()} type="submit">
              {isPending ? "Creating…" : "Create function"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
