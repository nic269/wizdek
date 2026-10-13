export type Maybe<T> = T | null | undefined;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${String(value)}`);
};
