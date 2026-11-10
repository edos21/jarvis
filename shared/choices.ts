// A guard for a value that must be one of a fixed list (a chart range from a query string, say).
export const oneOf =
  <T extends string | number>(choices: readonly T[]) =>
  (value: unknown): value is T =>
    choices.includes(value as T);
