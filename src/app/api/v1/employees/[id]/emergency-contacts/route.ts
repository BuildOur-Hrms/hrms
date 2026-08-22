import { withApi } from "@/lib/api";
import { addEmergencyContact, listEmergencyContacts } from "@/modules/employees/service";
import {
  emergencyContactSchema,
  idParamSchema,
  type EmergencyContactInput,
} from "@/modules/employees/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Own record or `employee.edit` — the check lives in the service because
 * "your own" is not something a static permission can express.
 */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema },
  async ({ ctx, params }) => listEmergencyContacts(ctx, params.id),
);

export const POST = withApi<EmergencyContactInput, Record<string, never>, Params>(
  { body: emergencyContactSchema, params: idParamSchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body, params }) => addEmergencyContact(ctx, params.id, body),
);
