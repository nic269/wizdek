export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const toInt = (value: string | number, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
