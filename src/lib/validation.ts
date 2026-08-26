import { z } from "zod";

/**
 * Zod pieces that more than one module needs.
 *
 * Small on purpose: a shared validators file that accumulates every schema
 * becomes a second place to look for the rules of a module. What belongs here
 * is the handful of shapes where getting it wrong is easy and getting it
 * wrong once is enough.
 */

/**
 * A boolean that arrived as text.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, and every non-empty string is
 * truthy — so `?includeArchived=false` reads as `true`, the exact opposite of
 * what the caller asked for, and silently. Query strings and environment
 * variables carry text, so they have to be read as text.
 */
export const queryBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", ""])])
  .transform((value) => value === true || value === "true" || value === "1");
