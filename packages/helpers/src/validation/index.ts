import { z } from "zod";

export const cuidSchema = z.string().min(8);
export const emailSchema = z.string().email();
export const nonEmptyString = z.string().trim().min(1);
