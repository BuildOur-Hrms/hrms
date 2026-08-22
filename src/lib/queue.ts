import { env, isServerless } from "./env";
import { logger } from "./logger";

/**
 * Background jobs. Job catalog and schedules: docs/05-architecture.md §7.
 *
 * With `REDIS_URL` set, jobs go to BullMQ and are executed by the worker
 * process with retries and backoff. Without it, the fallback driver runs the
 * handler in-process, so the whole flow can be exercised with only Postgres
 * running — and so a serverless deployment with no worker can still send an
 * invite email. In production the fallback has to be requested explicitly with
 * `QUEUE_DRIVER=inline`; it is never fallen into by accident.
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

    const context = { ...(options.requestId ? { requestId: options.requestId } : {}) };

    const run = handler(payload, context).catch((error: unknown) => {
      // A failed background job must never fail the request that triggered it.
      logger.error({ err: error, job: name, requestId: options.requestId }, "inline job failed");
    });

    // On a serverless host the process is frozen the moment the response is
    // returned, so a detached promise is simply never finished — the invite
    // email would silently not be sent. Pay the latency and await it.
    if (isServerless) await run;
    else void run;
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

let warnedAboutInlineInProd = false;

async function driver(): Promise<QueueDriver> {
  if (env.REDIS_URL) return getBullDriver();

  if (env.NODE_ENV === "production") {
    // Refusing outright would make every invite and password reset a 500 on a
    // host with no worker process. Running without retries is a real
    // trade-off, so it has to be asked for by name rather than fallen into.
    if (env.QUEUE_DRIVER !== "inline") {
      throw new Error(
        "No REDIS_URL in production. Set one, or set QUEUE_DRIVER=inline to " +
          "accept in-process jobs with no retries.",
      );
    }
    if (!warnedAboutInlineInProd) {
      warnedAboutInlineInProd = true;
      logger.warn(
        "QUEUE_DRIVER=inline in production: jobs run in the request and are lost if they fail. " +
          "Move to Redis before this carries real payroll or document work.",
      );
    }
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
