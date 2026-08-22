import { z } from "zod";

import { list, withApi } from "@/lib/api";
import { listUsers } from "@/modules/rbac/service";

export const runtime = "nodejs";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(["invited", "active", "disabled"]).optional(),
  role: z.string().trim().max(60).optional(),
});
type Query = z.infer<typeof querySchema>;

export const GET = withApi<Record<string, never>, Query>(
  { permission: "users.view_all", query: querySchema },
  async ({ ctx, query }) => {
    const result = await listUsers(ctx, query);
    return list(result.data, result.meta);
  },
);
