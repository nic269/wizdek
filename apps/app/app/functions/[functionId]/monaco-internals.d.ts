// Monaco ships no types for its internal modules; these cover what the
// editor setup uses.
declare module "monaco-editor/esm/vs/base/common/async.js" {
  export class Delayer<T> {
    trigger(task: () => T | Promise<T>, delay?: number): Promise<T>;
  }
}

declare module "monaco-editor/esm/vs/base/common/errors.js" {
  export function isCancellationError(error: unknown): boolean;
}
