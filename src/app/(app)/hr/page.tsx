import { redirect } from "next/navigation";

/**
 * `/hr` is a section, not a screen. Send people to the first thing under it
 * they can actually use rather than 404ing on a URL they reasonably guessed.
 */
export default function HrIndex() {
  redirect("/hr/employees");
}
