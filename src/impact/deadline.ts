import { performance } from 'node:perf_hooks';
import { ImpactActionError } from './errors';

export interface DeadlineDependencies {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

const defaultDependencies: DeadlineDependencies = {
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/** One monotonic deadline shared by collection, HTTP attempts, validation, and report output. */
export class ActionDeadline {
  private readonly expiresAt: number;

  public constructor(
    timeoutMilliseconds: number,
    private readonly dependencies: DeadlineDependencies = defaultDependencies,
  ) {
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 600_000) {
      throw new ImpactActionError('invalid_input', 'timeout-seconds must be an integer from 1 through 600');
    }
    this.expiresAt = dependencies.now() + timeoutMilliseconds;
  }

  public remainingMilliseconds(): number {
    return Math.max(0, Math.floor(this.expiresAt - this.dependencies.now()));
  }

  public throwIfExpired(): void {
    if (this.remainingMilliseconds() <= 0) {
      throw new ImpactActionError('action_deadline_exceeded', 'Alconite Impact exceeded the overall Action deadline.');
    }
  }

  public signal(): AbortSignal {
    this.throwIfExpired();
    return AbortSignal.timeout(Math.max(1, this.remainingMilliseconds()));
  }

  public async wait(milliseconds: number): Promise<void> {
    this.throwIfExpired();
    const remaining = this.remainingMilliseconds();
    if (milliseconds >= remaining) {
      throw new ImpactActionError('action_deadline_exceeded', 'Alconite Impact exhausted its deadline before another retry.');
    }
    await this.dependencies.sleep(milliseconds);
    this.throwIfExpired();
  }
}
