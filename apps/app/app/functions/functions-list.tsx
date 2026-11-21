"use client";

import {
  Button,
  EmptyState,
  ErrorAlert,
  PageHeader,
  Plus,
  ReadOnlyBanner,
  SkeletonRows,
  SquareCode,
  StatusBadge,
} from "@repo/design-system";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { RUNTIME_LABELS } from "@repo/functions/definition";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { formatRelative, formatWhen } from "../lib/format";
import { usePermissions } from "../lib/permissions";
import {
  type FunctionListItem,
  useFunctions,
  useFunctionsStatus,
} from "../lib/queries";
import { NewFunctionDialog } from "./new-function-dialog";
import { FunctionsNotEnabled, RunnerUnreachable } from "./not-enabled";

const COLUMNS = "minmax(260px,2fr) minmax(220px,1.4fr) 140px";

const FunctionRow = ({ fn }: { fn: FunctionListItem }) => {
  const router = useRouter();
  const href = `/functions/${fn.id}`;
  return (
    <TableRow
      className="cursor-pointer"
      data-testid={`function-row-${fn.id}`}
      onClick={() => router.push(href)}
    >
      <TableCell className="h-[62px]">
        <div className="flex min-w-0 items-center gap-[11px]">
          <span className="grid size-8 shrink-0 place-items-center rounded-[7px] bg-sunken text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
            <SquareCode className="size-4" />
          </span>
          <div className="min-w-0">
            <Link
              className="block truncate font-semibold text-[13px] text-foreground leading-[1.3] hover:underline"
              href={href}
              onClick={(event) => event.stopPropagation()}
            >
              {fn.name}
            </Link>
            <div className="truncate text-muted-foreground text-xs leading-[1.4]">
              {RUNTIME_LABELS[fn.runtime]}
              {fn.description ? ` · ${fn.description}` : ""}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          {fn.lastRun ? (
            <>
              <StatusBadge status={fn.lastRun.status} />
              <span className="truncate text-muted-foreground text-xs">
                {formatRelative(fn.lastRun.createdAt)}
              </span>
            </>
          ) : (
            <StatusBadge tone="neutral">Never run</StatusBadge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-[12.5px] text-muted-foreground">
        {formatWhen(fn.updatedAt)}
      </TableCell>
    </TableRow>
  );
};

const FunctionsTable = ({
  functions,
  isLoading,
}: {
  functions: FunctionListItem[];
  isLoading: boolean;
}) => (
  <Table className="min-w-[720px] table-fixed">
    <TableHeader>
      <TableRow>
        <TableHead>Function</TableHead>
        <TableHead className="w-[34%]">Last run</TableHead>
        <TableHead className="w-[156px]">Updated</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {isLoading ? (
        <TableRow className="hover:bg-transparent">
          <TableCell className="h-auto p-0" colSpan={3}>
            <SkeletonRows columns={COLUMNS} label="Loading functions" />
          </TableCell>
        </TableRow>
      ) : (
        functions.map((fn) => <FunctionRow fn={fn} key={fn.id} />)
      )}
    </TableBody>
  </Table>
);

const FunctionsReadOnlyBanner = ({ canRun }: { canRun: boolean }) => (
  <ReadOnlyBanner>
    {canRun ? (
      <>
        You can run functions, but only people with the{" "}
        <strong>Create and edit functions</strong> permission can create or edit
        them.
      </>
    ) : (
      <>
        You can view functions and their runs, but not edit or run them. Ask an
        Owner for the <strong>Run functions</strong> permission to start runs.
      </>
    )}
  </ReadOnlyBanner>
);

const FunctionsEmpty = ({
  canManage,
  onCreate,
}: {
  canManage: boolean;
  onCreate: () => void;
}) => (
  <EmptyState
    action={
      canManage ? (
        <Button onClick={onCreate} type="button">
          Create your first function
        </Button>
      ) : undefined
    }
    description="Write a script with a main function, fill in its parameters and run it — like checking an API response or fixing a batch of records."
    icon={<SquareCode />}
    note={
      canManage
        ? undefined
        : "Only people who can manage functions can create them."
    }
    title="No functions yet"
  />
);

const DESCRIPTION =
  "Small Node.js and Python scripts you write here and run on Wizdek's runner.";

export function FunctionsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { organization } = useActiveOrganization();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const organizationId = organization?.id ?? null;
  const status = useFunctionsStatus(organizationId);
  const functions = useFunctions(organizationId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const canManage = can("functions:manage");
  const canRun = can("functions:run");
  const isEnabled = status.data?.enabled ?? true;

  // "Create a function" elsewhere in the app lands here with the dialog open.
  useEffect(() => {
    if (searchParams.get("new") && canManage && isEnabled) {
      setIsCreateOpen(true);
      router.replace(pathname);
    }
  }, [canManage, isEnabled, pathname, router, searchParams]);

  const all = functions.data ?? [];
  const isLoading = functions.isLoading || permissionsLoading;

  if (status.data && !status.data.enabled) {
    return (
      <>
        <PageHeader description={DESCRIPTION} title="Functions" />
        <FunctionsNotEnabled />
      </>
    );
  }

  return (
    <>
      <PageHeader
        actions={
          canManage ? (
            <Button onClick={() => setIsCreateOpen(true)} type="button">
              <Plus />
              New function
            </Button>
          ) : null
        }
        description={DESCRIPTION}
        title="Functions"
      />

      {permissionsLoading || canManage ? null : (
        <FunctionsReadOnlyBanner canRun={canRun} />
      )}
      {status.data?.enabled && !status.data.reachable ? (
        <RunnerUnreachable />
      ) : null}
      {functions.isError ? (
        <ErrorAlert
          onRetry={() => functions.refetch()}
          title="Couldn't load functions."
        />
      ) : null}

      {!(isLoading || functions.isError) && all.length === 0 ? (
        <FunctionsEmpty
          canManage={canManage}
          onCreate={() => setIsCreateOpen(true)}
        />
      ) : null}

      {functions.isError || (!isLoading && all.length === 0) ? null : (
        <FunctionsTable functions={all} isLoading={isLoading} />
      )}

      <NewFunctionDialog
        onOpenChange={setIsCreateOpen}
        open={isCreateOpen}
        organizationId={organizationId}
      />
    </>
  );
}
