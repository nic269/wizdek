import { describe, expect, it, vi } from "vitest";
import { pinnedLookup } from "../../server/oms-api/client";

describe("bridge pinned DNS lookup", () => {
  it.each([
    { address: "192.0.2.10", family: 4 },
    { address: "2001:db8::10", family: 6 },
  ])("returns only the validated $address for Node all-address lookup", (address) => {
    const callback = vi.fn();
    pinnedLookup(address)("oms.example.test", { all: true }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, [address]);
  });

  it.each([
    false,
    undefined,
  ])("uses the single-address signature when all is %s", (all) => {
    const callback = vi.fn();
    pinnedLookup({ address: "192.0.2.10", family: 4 })(
      "oms.example.test",
      { all },
      callback
    );
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, "192.0.2.10", 4);
  });
});
