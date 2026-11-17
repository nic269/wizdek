import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { FunctionsError } from "../src/errors";
import { type FakeRunner, startFakeRunner } from "../src/testing/fake-runner";

const suffix = () => randomUUID().replaceAll("-", "").slice(0, 12);

export const createOrganization = async () => {
  const id = suffix();
  const user = await prisma.user.create({
    data: {
      email: `functions-${id}@example.com`,
      emailVerified: true,
      name: "Functions test",
      status: "ACTIVE",
    },
  });
  const organization = await prisma.organization.create({
    data: { name: `Functions ${id}`, slug: `functions-${id}` },
  });
  return {
    actorId: user.id,
    async cleanup() {
      await prisma.organization.delete({ where: { id: organization.id } });
      await prisma.user.delete({ where: { id: user.id } });
    },
    organizationId: organization.id,
  };
};

/** Every audit row of an organization, as text, for scanning. */
export const auditText = async (organizationId: string) =>
  JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId } }));

/** Starts a fake runner and points the services at it. */
export const useFakeRunner = async (): Promise<FakeRunner> => {
  const fake = await startFakeRunner();
  connectRunner(fake.url, fake.token);
  return fake;
};

export const connectRunner = (url: string, token: string) => {
  process.env.FUNCTIONS_RUNNER_URL = url;
  process.env.FUNCTIONS_RUNNER_TOKEN = token;
};

export const disconnectRunner = () => {
  process.env.FUNCTIONS_RUNNER_URL = "";
  process.env.FUNCTIONS_RUNNER_TOKEN = "";
};

/** An address where nothing listens. */
export const UNREACHABLE_URL = "http://127.0.0.1:9";

export const failureOf = async (
  promise: Promise<unknown>
): Promise<FunctionsError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FunctionsError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a FunctionsError.");
};
