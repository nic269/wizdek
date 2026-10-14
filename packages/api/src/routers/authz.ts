import { hasPermission } from "@repo/auth/permissions";
import { getCurrentSession } from "@repo/auth/session";
import { prisma } from "@repo/database";
import {
  type DatabaseBackupRecord,
  type DatabaseConnectionRecord,
  findBackupById,
  findConnectionById,
} from "@repo/database-tools";
import {
  type FlowRecord,
  type FlowRunRecord,
  findFlowById,
  findRunById,
} from "@repo/flows";
import { findStoreById, type ShopifyStoreRecord } from "@repo/shopify/stores";
import { ApiError } from "../errors";

export const requireUser = async (headers: Headers) => {
  const session = await getCurrentSession(headers);
  if (!session) {
    throw new ApiError("UNAUTHORIZED", "Authentication required.", 401);
  }
  return session.user;
};

export const requireOrganizationPermission = async (
  userId: string,
  organizationId: string,
  module: string,
  action: string,
  message = "You do not have permission for this organization action."
) => {
  if (!(await hasPermission({ action, module, organizationId, userId }))) {
    throw new ApiError("FORBIDDEN", message, 403);
  }
};

/** Requires a session and one permission in the given organization. */
export const requireOrganizationAccess = async (
  headers: Headers,
  organizationId: string,
  module: string,
  action: string
) => {
  const user = await requireUser(headers);
  await requireOrganizationPermission(user.id, organizationId, module, action);
  return user;
};

/**
 * Authorizes an action on a record that belongs to an organization. Someone
 * who is not an active member of that organization gets the not-found error,
 * so the record's existence is not revealed; a member lacking the permission
 * gets 403.
 */
const requireMemberPermission = async (
  userId: string,
  organizationId: string,
  module: string,
  action: string,
  notFound: () => ApiError,
  forbiddenMessage: string
): Promise<void> => {
  if (await hasPermission({ action, module, organizationId, userId })) {
    return;
  }
  const membership = await prisma.membership.findUnique({
    select: { status: true },
    where: { userId_organizationId: { organizationId, userId } },
  });
  if (membership?.status !== "ACTIVE") {
    throw notFound();
  }
  throw new ApiError("FORBIDDEN", forbiddenMessage, 403);
};

const storeNotFound = () => new ApiError("NOT_FOUND", "Store not found.", 404);

/**
 * Authorizes an action on a store. The organization always comes from the
 * store row, never from input.
 */
export const requireStorePermission = async (
  headers: Headers,
  storeId: string,
  module: string,
  action: string
): Promise<{
  store: ShopifyStoreRecord;
  user: Awaited<ReturnType<typeof requireUser>>;
}> => {
  const user = await requireUser(headers);
  const store = await findStoreById(storeId);
  if (!store) {
    throw storeNotFound();
  }
  await requireMemberPermission(
    user.id,
    store.organizationId,
    module,
    action,
    storeNotFound,
    "You do not have permission for this store action."
  );
  return { store, user };
};

type FlowAction = "read" | "manage" | "run";

const flowNotFound = () => new ApiError("NOT_FOUND", "Flow not found.", 404);
const runNotFound = () => new ApiError("NOT_FOUND", "Run not found.", 404);

/** Authorizes an action on a flow; the organization comes from the flow row. */
export const requireFlowPermission = async (
  headers: Headers,
  flowId: string,
  action: FlowAction
): Promise<{
  flow: FlowRecord;
  user: Awaited<ReturnType<typeof requireUser>>;
}> => {
  const user = await requireUser(headers);
  const flow = await findFlowById(flowId);
  if (!flow) {
    throw flowNotFound();
  }
  await requireMemberPermission(
    user.id,
    flow.organizationId,
    "flows",
    action,
    flowNotFound,
    "You do not have permission for this flow action."
  );
  return { flow, user };
};

/** Authorizes an action on a run; the organization comes from the run row. */
export const requireRunPermission = async (
  headers: Headers,
  runId: string,
  action: FlowAction
): Promise<{
  run: FlowRunRecord;
  user: Awaited<ReturnType<typeof requireUser>>;
}> => {
  const user = await requireUser(headers);
  const run = await findRunById(runId);
  if (!run) {
    throw runNotFound();
  }
  await requireMemberPermission(
    user.id,
    run.organizationId,
    "flows",
    action,
    runNotFound,
    "You do not have permission for this flow action."
  );
  return { run, user };
};

type DatabaseAction = "read" | "manage" | "backup";

const connectionNotFound = () =>
  new ApiError("NOT_FOUND", "Database connection not found.", 404);
const backupNotFound = () =>
  new ApiError("NOT_FOUND", "Backup not found.", 404);

/**
 * Authorizes an action on a database connection; the organization comes from
 * the connection row.
 */
export const requireConnectionPermission = async (
  headers: Headers,
  connectionId: string,
  action: DatabaseAction
): Promise<{
  connection: DatabaseConnectionRecord;
  user: Awaited<ReturnType<typeof requireUser>>;
}> => {
  const user = await requireUser(headers);
  const connection = await findConnectionById(connectionId);
  if (!connection) {
    throw connectionNotFound();
  }
  await requireMemberPermission(
    user.id,
    connection.organizationId,
    "databases",
    action,
    connectionNotFound,
    "You do not have permission for this database action."
  );
  return { connection, user };
};

/** Authorizes an action on a backup; the organization comes from the backup row. */
export const requireBackupPermission = async (
  headers: Headers,
  backupId: string,
  action: DatabaseAction
): Promise<{
  backup: DatabaseBackupRecord;
  user: Awaited<ReturnType<typeof requireUser>>;
}> => {
  const user = await requireUser(headers);
  const backup = await findBackupById(backupId);
  if (!backup) {
    throw backupNotFound();
  }
  await requireMemberPermission(
    user.id,
    backup.organizationId,
    "databases",
    action,
    backupNotFound,
    "You do not have permission for this database action."
  );
  return { backup, user };
};
