import { describe, expect, it } from "vitest";
import { createAdmission } from "./admission";

describe("createAdmission", () => {
  it("admits runs until their memory limits reach the budget", () => {
    const admission = createAdmission(1024);

    expect(admission.tryAcquire(512)).not.toBeNull();
    expect(admission.tryAcquire(512)).not.toBeNull();
    expect(admission.tryAcquire(128)).toBeNull();
    expect(admission.usedMb()).toBe(1024);
  });

  it("frees the memory once, however often release is called", () => {
    const admission = createAdmission(512);
    const release = admission.tryAcquire(512);

    release?.();
    release?.();

    expect(admission.usedMb()).toBe(0);
    expect(admission.tryAcquire(512)).not.toBeNull();
  });
});
