export interface WorkflowActor {
  email: string;
  id: string;
  name: string;
  roleCode?: string;
}
export interface WorkflowRun {
  actor: WorkflowActor | null;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  errorCount: number;
  featureKey: string;
  id: string;
  logCount: number;
  module: string;
  startedAt: string;
  status: string;
  summary?: unknown;
  targetId: string | null;
  targetType: string | null;
  title: string;
  warningCount: number;
  workflowKey: string;
}
export interface WorkflowLog {
  createdAt: string;
  durationMs: number | null;
  errorCode: string | null;
  errorDetails: unknown;
  errorMessage: string | null;
  errorName: string | null;
  event: string;
  id: string;
  level: string;
  message: string;
  metadata: unknown;
  operationName: string | null;
  rowNumber: number | null;
  sequence: number;
  shopDomain: string | null;
  stage: string;
  status: string;
  targetId: string | null;
  targetType: string | null;
}
export interface WorkflowDetail {
  logs: WorkflowLog[];
  nextSequence: number | null;
  run: WorkflowRun;
}
export function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}
export function formatLogDate(
  value: string | null | undefined,
  timeOnly = false,
  timeZone?: string
) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(
    undefined,
    timeOnly
      ? {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone,
        }
      : {
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          month: "2-digit",
          second: "2-digit",
          timeZone,
          year: "numeric",
        }
  ).format(new Date(value));
}
export function formatLogLabel(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
