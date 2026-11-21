"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { Button, ErrorAlert, Input, toast } from "@repo/design-system";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system/components/ui/alert-dialog";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { FUNCTION_LIMITS, RUNTIME_LABELS } from "@repo/functions/definition";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Field } from "../../lib/form-parts";
import { OptionSelect } from "../../lib/option-select";
import { ConnectionsSection } from "./connections-section";
import type { CodeFunction, FunctionEditor } from "./use-function-editor";

const MEMORY_OPTIONS = FUNCTION_LIMITS.memoryMb.map((mb) => ({
  label: `${mb} MB`,
  value: String(mb),
}));

const DeleteFunction = ({ fn }: { fn: CodeFunction }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const remove = async () => {
    setIsWorking(true);
    try {
      await apiClient.functions.delete({ functionId: fn.id });
      toast.success("Function deleted", { description: fn.name });
      router.push("/functions");
    } catch (cause) {
      toast.error("Could not delete the function", {
        description: getApiErrorMessage(cause, "Try again."),
      });
      setIsWorking(false);
    }
  };
  return (
    <section className="space-y-2 border-border border-t pt-4">
      <h3 className="font-semibold text-[13px]">Delete function</h3>
      <p className="text-[12.5px] text-muted-foreground">
        Removes its files and run history.
      </p>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="destructive"
      >
        Delete function…
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {fn.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its files and every run are removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={isWorking} onClick={remove} variant="danger">
              {isWorking ? "Deleting…" : "Delete function"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export function SettingsTab({
  canManage,
  editor,
  fn,
}: {
  canManage: boolean;
  editor: FunctionEditor;
  fn: CodeFunction;
}) {
  const [name, setName] = useState(fn.name);
  const [description, setDescription] = useState(fn.description ?? "");
  const [timeout, setTimeoutSeconds] = useState(String(fn.timeoutSeconds));
  const [memory, setMemory] = useState(String(fn.memoryMb));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(fn.name);
    setDescription(fn.description ?? "");
    setTimeoutSeconds(String(fn.timeoutSeconds));
    setMemory(String(fn.memoryMb));
  }, [fn.description, fn.memoryMb, fn.name, fn.timeoutSeconds]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await editor.updateSettings({
        description: description.trim() || null,
        memoryMb: Number(memory),
        name: name.trim(),
        timeoutSeconds: Number(timeout),
      });
      toast.success("Settings saved");
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the settings."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name">
          <Input
            aria-label="Name"
            disabled={!canManage}
            maxLength={FUNCTION_LIMITS.nameLength}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </Field>
        <Field label="Description">
          <Textarea
            aria-label="Description"
            disabled={!canManage}
            maxLength={FUNCTION_LIMITS.descriptionLength}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            value={description}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            hint={`Up to ${FUNCTION_LIMITS.timeoutSeconds} seconds.`}
            label="Timeout (seconds)"
          >
            <Input
              aria-label="Timeout in seconds"
              disabled={!canManage}
              max={FUNCTION_LIMITS.timeoutSeconds}
              min={1}
              onChange={(event) => setTimeoutSeconds(event.target.value)}
              required
              step={1}
              type="number"
              value={timeout}
            />
          </Field>
          <Field label="Memory">
            <OptionSelect
              aria-label="Memory"
              disabled={!canManage}
              onValueChange={(value) => setMemory(value)}
              options={MEMORY_OPTIONS}
              value={memory}
            />
          </Field>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          Runtime: {RUNTIME_LABELS[fn.runtime]}
        </p>
        {error ? <ErrorAlert message={error} title="Not saved." /> : null}
        {canManage ? (
          <Button disabled={isSaving || !name.trim()} size="sm" type="submit">
            {isSaving ? "Saving…" : "Save settings"}
          </Button>
        ) : null}
      </form>
      <ConnectionsSection
        canManage={canManage}
        functionId={fn.id}
        organizationId={fn.organizationId}
      />
      {canManage ? <DeleteFunction fn={fn} /> : null}
    </div>
  );
}
