import { withApi } from "@/lib/api";
import { me } from "@/modules/auth/service";

export const runtime = "nodejs";

/** GET /api/v1/auth/me — session identity, roles and permission set. */
export const GET = withApi({}, async ({ ctx }) => me(ctx));
