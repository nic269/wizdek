import { implement } from "@orpc/server";
import type { ApiContext } from "../context";
import { contract } from "../contracts";

export const os = implement(contract).$context<ApiContext>();
