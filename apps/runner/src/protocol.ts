import { z } from "zod";

export const RUNTIMES = ["NODE", "PYTHON"] as const;
export type RuntimeId = (typeof RUNTIMES)[number];

export const LIMITS = {
  fileBytes: 256 * 1024,
  files: 50,
  memoryMb: [128, 256, 512, 1024],
  outputBytes: 1024 * 1024,
  resultBytes: 256 * 1024,
  sourceBytes: 1024 * 1024,
  timeoutSeconds: 900,
} as const;

/** The file a runtime starts from, in order of preference. */
export const ENTRY_FILES: Record<RuntimeId, readonly string[]> = {
  NODE: ["index.ts", "index.mts", "index.js", "index.mjs"],
  PYTHON: ["main.py"],
};

const PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const MAX_PATH_LENGTH = 200;

/**
 * A path that stays inside the function's directory: relative, made of plain
 * segments, and outside the directory installed packages are mounted at.
 */
export const isSafeRelativePath = (path: string): boolean => {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return false;
  }
  const segments = path.split("/");
  return (
    segments[0] !== "node_modules" &&
    segments.every(
      (segment) =>
        PATH_SEGMENT.test(segment) && segment !== "." && segment !== ".."
    )
  );
};

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

const fileSchema = z.object({
  content: z.string(),
  path: z.string().refine(isSafeRelativePath, "Invalid file path."),
});

export const runRequestSchema = z
  .object({
    env: z.record(z.string(), z.string()).default({}),
    files: z.array(fileSchema).min(1).max(LIMITS.files),
    memoryMb: z
      .number()
      .refine(
        (value) => (LIMITS.memoryMb as readonly number[]).includes(value),
        "Unsupported memory size."
      ),
    /** Parameter names in the order `main` declares them. */
    paramOrder: z.array(z.string()).optional(),
    params: z.record(z.string(), z.unknown()).default({}),
    runId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
    runtime: z.enum(RUNTIMES),
    timeoutSeconds: z.number().int().min(1).max(LIMITS.timeoutSeconds),
  })
  .superRefine((request, context) => {
    const seen = new Set<string>();
    let total = 0;
    for (const file of request.files) {
      const bytes = byteLength(file.content);
      total += bytes;
      if (bytes > LIMITS.fileBytes) {
        context.addIssue({
          code: "custom",
          message: `${file.path} is larger than ${LIMITS.fileBytes} bytes.`,
        });
      }
      if (seen.has(file.path)) {
        context.addIssue({
          code: "custom",
          message: `${file.path} is listed twice.`,
        });
      }
      seen.add(file.path);
    }
    if (total > LIMITS.sourceBytes) {
      context.addIssue({
        code: "custom",
        message: `The files are larger than ${LIMITS.sourceBytes} bytes in total.`,
      });
    }
  });

export type RunRequest = z.infer<typeof runRequestSchema>;

export const inspectRequestSchema = z.object({
  runtime: z.enum(RUNTIMES),
  source: z
    .string()
    .refine(
      (source) => byteLength(source) <= LIMITS.fileBytes,
      "The file is too large."
    ),
});

export type RunStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELED";

export type RunEvent =
  | { type: "started" }
  | { data: string; stream: "stdout" | "stderr"; type: "output" }
  | {
      durationMs: number;
      error?: string;
      exitCode: number | null;
      oomKilled: boolean;
      result?: unknown;
      status: RunStatus;
      truncated: boolean;
      type: "exit";
    };

export type ParamType = "string" | "number" | "integer" | "boolean" | "array";

/** One parameter of `main`. No `type` means any JSON value. */
export interface ParamSchema {
  default?: unknown;
  description?: string;
  enum?: string[];
  items?: { type: Exclude<ParamType, "array"> };
  type?: ParamType;
}

export interface ParamsSchema {
  properties: Record<string, ParamSchema>;
  required: string[];
  type: "object";
  /** Parameter names in declaration order. */
  "x-order": string[];
}

export type InspectResult = { schema: ParamsSchema } | { error: string };
