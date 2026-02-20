type Task<T> = () => Promise<T>;

export type ConcurrencyOptions = {
  concurrency: number;
};

export class ConcurrencyLimiter {
  private readonly concurrency: number;
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
      throw new Error("Concurrency must be a positive number.");
    }
    this.concurrency = Math.floor(concurrency);
  }

  async run<T>(task: Task<T>): Promise<T> {
    await this.acquire();

    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  options: ConcurrencyOptions,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limiter = new ConcurrencyLimiter(options.concurrency);
  const results: R[] = new Array(items.length);

  await Promise.all(
    items.map((item, index) =>
      limiter.run(async () => {
        results[index] = await mapper(item, index);
      }),
    ),
  );

  return results;
}

export async function runWithConcurrency<T>(
  tasks: Array<Task<T>>,
  options: ConcurrencyOptions,
): Promise<T[]> {
  const limiter = new ConcurrencyLimiter(options.concurrency);

  return Promise.all(tasks.map((task) => limiter.run(task)));
}
