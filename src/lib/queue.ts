import { env } from "./env";
import { logger } from "./logger";

/**
 * Background jobs. Job catalog and schedules: docs/05-architecture.md §7.
 *
 * With `REDIS_URL` set, jobs go to BullMQ and are executed by the worker
 * process with retries and backoff. Without it, the fallback driver runs the
 * handler inline (after the response, best-effort, no retries) so a developer
 * can exercise the whole flow with only Postgres running. The fallback refuses
 * to start in production.
 */

export interface JobPayloads {
  "send-email": {
    to: string;
    subject: string;
    html: string;
    text: string;
  };
  "attendance-daily-calc": { companyId: string; workDate: string };
  "leave-accrual": { companyId: string; year: number; month: number };
  "leave-year-rollover": { companyId: string; year: number };
  "birthday-anniversary": { companyId: string; onDate: string };
  "probation-end-reminder": { companyId: string; onDate: string };
}

export type JobName = keyof JobPayloads;

export interface JobContext {
  /** Propagated from the request that enqueued the job, for log correlation. */
  requestId?: string;
}

export type JobHandler<N extends JobName> = (
  payload: JobPayloads[N],
  context: JobContext,
) => Promise<void>;

const handlers = new Map<JobName, JobHandler<JobName>>();

export function registerJobHandler<N extends JobName>(name: N, handler: JobHandler<N>): void {
  handlers.set(name, handler as JobHandler<JobName>);
}

export interface EnqueueOptions {
  requestId?: string;
  /** Delay in milliseconds before the job becomes eligible to run. */
  delayMs?: number;
  attempts?: number;
}

interface QueueDriver {
  readonly name: string;
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions,
  ): Promise<void>;
  depth(): Promise<number>;
  healthy(): Promise<boolean>;
}

// ─────────────────────────────────────────────── inline fallback

const inlineDriver: QueueDriver = {
  name: "inline",
  async enqueue(name, payload, options) {
    const handler = handlers.get(name);
    if (!handler) {
      logger.error({ job: name }, "no handler registered for job (inline driver)");
      return;
    }
    // Detached on purpose: a failed background job must never fail the request
    // that triggered it.
    void handler(payload, { ...(options.requestId ? { requestId: options.requestId } : {}) }).catch(
      (error: unknown) => {
        logger.error({ err: error, job: name, requestId: options.requestId }, "inline job failed");
      },
    );
  },
  async depth() {
    return 0;
  },
  async healthy() {
    return true;
  },
};

// ─────────────────────────────────────────────── BullMQ

const QUEUE_NAME = "hrms";

let bullDriverPromise: Promise<QueueDriver> | null = null;

async function getBullDriver(): Promise<QueueDriver> {
  bullDriverPromise ??= (async () => {
    const { Queue } = await import("bullmq");
    const queue = new Queue(QUEUE_NAME, {
      connection: { url: env.REDIS_URL! },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3_600 },
      },
    });

    return {
      name: "bullmq",
      async enqueue(name, payload, options) {
        await queue.add(
          name,
          { ...payload, __requestId: options.requestId },
          {
            ...(options.delayMs ? { delay: options.delayMs } : {}),
            ...(options.attempts ? { attempts: options.attempts } : {}),
          },
        );
      },
      async depth() {
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
        return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
      },
      async healthy() {
        try {
          await queue.getJobCounts("waiting");
          return true;
        } catch {
          return false;
        }
      },
    } satisfies QueueDriver;
  })();
  return bullDriverPromise;
}

async function driver(): Promise<QueueDriver> {
  if (env.REDIS_URL) return getBullDriver();
  if (env.NODE_ENV === "production") {
    throw new Error("REDIS_URL is required in production — the inline queue driver has no retries");
  }
  return inlineDriver;
}

export async function enqueue<N extends JobName>(
  name: N,
  payload: JobPayloads[N],
  options: EnqueueOptions = {},
): Promise<void> {
  const d = await driver();
  logger.debug({ job: name, driver: d.name, requestId: options.requestId }, "enqueue");
  await d.enqueue(name, payload, options);
}

/** Readiness data for `/api/health`. */
export async function queueHealth(): Promise<{ driver: string; healthy: boolean; depth: number }> {
  try {
    const d = await driver();
    return { driver: d.name, healthy: await d.healthy(), depth: await d.depth() };
  } catch (error) {
    logger.error({ err: error }, "queue health check failed");
    return { driver: "unavailable", healthy: false, depth: -1 };
  }
}
