export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  message = "Operation timed out"
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};
