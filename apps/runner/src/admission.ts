export interface Admission {
  /** Reserves memory for a run, or returns null when the budget is spent. */
  tryAcquire(memoryMb: number): (() => void) | null;
  usedMb(): number;
}

/**
 * Keeps the memory limits of running containers within a budget, so the
 * runner never promises more memory than the machine has.
 */
export const createAdmission = (budgetMb: number): Admission => {
  let used = 0;
  return {
    tryAcquire(memoryMb) {
      if (used + memoryMb > budgetMb) {
        return null;
      }
      used += memoryMb;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          used -= memoryMb;
        }
      };
    },
    usedMb: () => used,
  };
};
