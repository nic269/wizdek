type DateInput = Date | string | null | undefined;

const toDate = (value: DateInput) =>
  value === null || value === undefined ? null : new Date(value);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * "just now", "2 min ago", "9:25 AM" today, "Yesterday", then "Oct 12".
 * Lists use it for recency; exact times stay in titles and detail views.
 */
export const formatRelative = (value: DateInput, now = new Date()): string => {
  const date = toDate(value);
  if (!date) {
    return "never";
  }
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)} min ago`;
  }
  if (sameDay(date, now)) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** "Today 4:00 PM", "Yesterday 11:40 PM" or "Oct 12, 4:00 PM". */
export const formatWhen = (value: DateInput, now = new Date()): string => {
  const date = toDate(value);
  if (!date) {
    return "never";
  }
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay(date, now)) {
    return `Today ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) {
    return `Yesterday ${time}`;
  }
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
};

/** A full timestamp for titles: "Oct 14, 2026, 9:25 PM". */
export const formatDateTime = (value: DateInput): string => {
  const date = toDate(value);
  return date
    ? date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "never";
};

/** "41s", "3m 1s", "1h 4m": elapsed between two moments, or until now. */
export const formatDuration = (start: DateInput, end?: DateInput): string => {
  const from = toDate(start);
  if (!from) {
    return "—";
  }
  const to = toDate(end) ?? new Date();
  const seconds = Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 1000)
  );
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** "48.2 MB" from a byte count, sent as a decimal string for large files. */
export const formatBytes = (value: string | number | null): string => {
  if (value === null) {
    return "—";
  }
  let size = Number(value);
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${BYTE_UNITS[unit]}`;
};

export const plural = (count: number, word: string, many = `${word}s`) =>
  `${count.toLocaleString()} ${count === 1 ? word : many}`;
