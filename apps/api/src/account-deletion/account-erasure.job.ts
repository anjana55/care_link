import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountDeletionService } from './account-deletion.service';

const TICK_MS = 60 * 60 * 1000;

/**
 * Hourly: erases the accounts whose grace period has passed and that have
 * nothing left open. Off in tests, and with ACCOUNT_ERASURE_ENABLED=false.
 */
@Injectable()
export class AccountErasureJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AccountErasureJob.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly deletion: AccountDeletionService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('ACCOUNT_ERASURE_ENABLED') === 'false') return;
    const tick = () => void this.tick().catch((err) => this.logger.warn(`Account erasure failed: ${(err as Error).message}`));
    const first = setTimeout(tick, 5 * 60_000);
    const every = setInterval(tick, TICK_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.deletion.eraseDue(now);
    } finally {
      this.running = false;
    }
  }
}
