import { withApi } from "@/lib/api";
import { listSettings } from "@/modules/settings/service";

export const runtime = "nodejs";

export const GET = withApi({ permission: "settings.manage" }, async ({ ctx }) => listSettings(ctx));
