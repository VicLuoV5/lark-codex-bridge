import { log } from '../core/logger';

/**
 * FIFO concurrency cap for Codex runs. Especially useful in topic-group
 * scenarios where each topic spawns its own run — without a cap, a single
 * busy group could trivially explode to dozens of concurrent Codex
 * subprocesses, drowning RAM and model-side limits.
 *
 * Use:
 *   const pool = new ProcessPool();
 *   const release = await pool.acquire();
 *   try { ... } finally { release(); }
 *
 * The cap is read fresh each `acquire()`, so `/config maxConcurrentRuns`
 * takes effect for the next run that asks for a slot.
 */
export class ProcessPool {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  /** Snapshot of the cap captured at the moment acquire() decided to wait. */
  private cap: () => number;

  constructor(cap: () => number) {
    this.cap = cap;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.cap()) {
      this.active++;
      log.info('pool', 'acquired', { active: this.active, cap: this.cap() });
      return () => this.release();
    }
    log.info('pool', 'wait', { active: this.active, cap: this.cap(), waiting: this.waiters.length + 1 });
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    log.info('pool', 'acquired', { active: this.active, cap: this.cap() });
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    log.info('pool', 'released', { active: this.active });
    // Wake the next waiter if there's headroom. If cap was just lowered
    // via /config, this naturally throttles by not waking.
    if (this.active < this.cap() && this.waiters.length > 0) {
      const next = this.waiters.shift();
      if (next) next();
    }
  }

  snapshot(): { active: number; waiting: number; cap: number } {
    return { active: this.active, waiting: this.waiters.length, cap: this.cap() };
  }
}
