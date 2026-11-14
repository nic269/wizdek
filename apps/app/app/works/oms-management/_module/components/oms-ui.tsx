"use client";

import { cn, Input } from "@repo/design-system";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/design-system/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import type { ComponentProps, ReactNode } from "react";

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <Card className={cn("gap-4", className)}>
      {title || description || action ? (
        <CardHeader className="grid-cols-[1fr_auto] gap-x-4 border-border border-b pb-4">
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
          {action ? (
            <div className="col-start-2 row-span-2 row-start-1">{action}</div>
          ) : null}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function FormField({
  id,
  label,
  description,
  children,
  className,
}: {
  id?: string | undefined;
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <Field className={cn("gap-1.5", className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description ? (
        <FieldDescription className="text-xs">{description}</FieldDescription>
      ) : null}
    </Field>
  );
}

export function TextField({
  id,
  label,
  description,
  ...props
}: ComponentProps<typeof Input> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <FormField description={description} id={id} label={label}>
      <Input id={id} {...props} />
    </FormField>
  );
}

export function CheckboxField({
  id,
  label,
  description,
  className,
  ...props
}: ComponentProps<typeof Checkbox> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Field className={cn("gap-1.5", className)} orientation="horizontal">
      <Checkbox id={id} {...props} />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription className="text-xs">{description}</FieldDescription>
        ) : null}
      </div>
    </Field>
  );
}

export interface Choice {
  label: string;
  value: string;
}

export function ChoiceSelect({
  id,
  label,
  value,
  onValueChange,
  choices,
  placeholder,
  className,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  choices: readonly Choice[];
  placeholder?: string;
  className?: string | undefined;
}) {
  return (
    <FormField className={className} id={id} label={label}>
      <Select
        items={choices}
        onValueChange={(next) => next !== null && onValueChange(next)}
        value={value || null}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
