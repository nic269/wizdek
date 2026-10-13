import { createHmac, timingSafeEqual } from "node:crypto";

export const createHmacSignature = (payload: string | Buffer, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

export const verifyHmacSignature = (
  payload: string | Buffer,
  secret: string,
  signature: string
) => {
  const expected = Buffer.from(createHmacSignature(payload, secret), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
