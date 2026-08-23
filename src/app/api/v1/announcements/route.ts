import { z } from "zod";

import { withApi } from "@/lib/api";
import {
  assertCanAnnounce,
  createAnnouncement,
  listAnnouncements,
} from "@/modules/notifications/service";

export const runtime = "nodejs";

const querySchema = z.object({
  /** Drafts are only ever shown to somebody who could have written one. */
  includeDrafts: z.coerce.boolean().default(false),
});
type Query = z.infer<typeof querySchema>;

const bodySchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    bodyHtml: z.string().trim().min(1).max(20000),
    audience: z.enum(["company", "department"]).default("company"),
    departmentId: z.string().uuid().nullish(),
    publish: z.coerce.boolean().default(false),
  })
  .refine((v) => v.audience === "company" || !!v.departmentId, {
    message: "Choose a department",
    path: ["departmentId"],
  });
type Body = z.infer<typeof bodySchema>;

export const GET = withApi<Record<string, never>, Query>(
  { query: querySchema },
  async ({ ctx, query }) => {
    const includeDrafts = query.includeDrafts && ctx.permissions.has("announcements.create");
    return listAnnouncements(ctx, includeDrafts);
  },
);

export const POST = withApi<Body>(
  { body: bodySchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body }) => {
    assertCanAnnounce(ctx);
    return createAnnouncement(ctx, body);
  },
);
