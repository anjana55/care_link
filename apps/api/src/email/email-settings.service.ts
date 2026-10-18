import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { emailSettings } from '../database/schema';
import { decryptSecret, deriveKey, encryptSecret } from '../common/utils/secret-box.util';
import { UpdateEmailSettingsDto } from './dto/update-email-settings.dto';

const SETTINGS_ID = 'default';
const DEFAULT_FROM_NAME = 'CareLink';

type Row = typeof emailSettings.$inferSelect;

/** What EmailService works with: the row plus the decrypted password. */
export interface ResolvedEmailSettings extends Omit<Row, 'passwordEncrypted'> {
  password: string | null;
  /** Enabled AND complete - the only state in which mail is actually sent. */
  usable: boolean;
}

/** What the admin UI sees: no password, only the fact that one is stored. */
export type AdminEmailSettings = Omit<Row, 'passwordEncrypted'> & {
  passwordSet: boolean;
  usable: boolean;
};

/**
 * Splits an SMTP_FROM such as `CareLink <no-reply@example.com>` (or a bare
 * address) into the name and address the settings row stores separately.
 */
export function parseFromHeader(raw: string | undefined): { name: string | null; address: string | null } {
  const value = (raw ?? '').trim().replace(/^"|"$/g, '');
  if (!value) return { name: null, address: null };
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
  if (match) return { name: match[1].trim() || null, address: match[2] };
  return /^[^\s@<>]+@[^\s@<>]+$/.test(value) ? { name: null, address: value } : { name: null, address: null };
}

/**
 * Owns the single admin-managed outgoing-mail row (Settings > Email).
 *
 * Read on every send rather than cached, like the WhatsApp and social sign-in
 * settings: one primary-key lookup per email is nothing next to an SMTP round
 * trip, and it means an admin's change takes effect on every API instance
 * immediately, with no restart.
 */
@Injectable()
export class EmailSettingsService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    // Same root as the other stored secrets: SETTINGS_ENCRYPTION_KEY, falling
    // back to the refresh secret so a deployment that never set it still boots.
    const root = this.config.get<string>('SETTINGS_ENCRYPTION_KEY') || this.config.get<string>('JWT_REFRESH_SECRET') || '';
    this.encryptionKey = deriveKey(root, 'email-settings');
  }

  /** Returns the row, creating it from the bootstrap SMTP_* environment on first use. */
  private async getRow(): Promise<Row> {
    const [existing] = await this.db.select().from(emailSettings).where(eq(emailSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;

    const env = (k: string) => this.config.get<string>(k)?.toString().trim() || undefined;
    const host = env('SMTP_HOST');
    const user = env('SMTP_USER');
    const pass = env('SMTP_PASSWORD');
    const from = parseFromHeader(env('SMTP_FROM'));
    const port = Number(env('SMTP_PORT'));

    // ON DUPLICATE KEY keeps this safe if two instances race to create the row.
    await this.db
      .insert(emailSettings)
      .values({
        id: SETTINGS_ID,
        // An environment that already had a server configured was delivering
        // mail; keep it delivering after the upgrade.
        enabled: Boolean(host && from.address),
        host: host ?? null,
        port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 587,
        secure: env('SMTP_SECURE') === 'true',
        username: user ?? null,
        passwordEncrypted: pass ? encryptSecret(pass, this.encryptionKey) : null,
        fromName: from.name ?? DEFAULT_FROM_NAME,
        fromAddress: from.address,
      })
      .onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });

    const [created] = await this.db.select().from(emailSettings).where(eq(emailSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  private resolve(row: Row): ResolvedEmailSettings {
    const { passwordEncrypted, ...rest } = row;
    const password = decryptSecret(passwordEncrypted, this.encryptionKey);
    return { ...rest, password, usable: row.enabled && Boolean(row.host) && Boolean(row.fromAddress) };
  }

  async getResolved(): Promise<ResolvedEmailSettings> {
    return this.resolve(await this.getRow());
  }

  async getForAdmin(): Promise<AdminEmailSettings> {
    const { password, ...rest } = this.resolve(await this.getRow());
    // Unlike an API token, a mailbox password gets no "last characters" hint:
    // it may be one a person chose and reuses.
    return { ...rest, passwordSet: Boolean(password) };
  }

  async update(dto: UpdateEmailSettingsDto, updatedBy: string): Promise<AdminEmailSettings> {
    const current = await this.getResolved();

    const text = (v: string | undefined, fallback: string | null) => (v === undefined ? fallback : v.trim() || null);
    const next = {
      enabled: dto.enabled ?? current.enabled,
      host: text(dto.host, current.host),
      port: dto.port ?? current.port,
      secure: dto.secure ?? current.secure,
      username: text(dto.username, current.username),
      fromName: text(dto.fromName, current.fromName) ?? DEFAULT_FROM_NAME,
      fromAddress: text(dto.fromAddress, current.fromAddress),
      replyTo: text(dto.replyTo, current.replyTo),
    };
    const newPassword = dto.password ? dto.password : null; // not trimmed: spaces can be part of a password
    // A password only means something alongside a username, so clearing the
    // username (switching to an unauthenticated relay) drops it too.
    const clearPassword = Boolean(dto.clearPassword) || !next.username;
    const nextPassword = clearPassword ? null : (newPassword ?? current.password);

    // A stored password belongs to one mailbox. Keeping it against a different
    // username would silently pair two unrelated credentials, and the only
    // symptom would be every email failing to authenticate.
    if (current.password && current.username && next.username && next.username !== current.username && !newPassword && !clearPassword) {
      throw new BadRequestException('Enter the password again when changing the username');
    }

    // Validate the *resulting* configuration so an admin cannot leave delivery
    // switched on with half a setup.
    if (next.enabled) {
      const missing: string[] = [];
      if (!next.host) missing.push('server host');
      if (!next.fromAddress) missing.push('sender address');
      if (next.username && !nextPassword) missing.push('password');
      if (missing.length) throw new BadRequestException(`Cannot turn on email delivery without: ${missing.join(', ')}`);
    }
    const patch: Partial<typeof emailSettings.$inferInsert> = { ...next, updatedBy, updatedAt: new Date() };
    if (clearPassword) patch.passwordEncrypted = null;
    else if (newPassword) patch.passwordEncrypted = encryptSecret(newPassword, this.encryptionKey);

    await this.db.update(emailSettings).set(patch).where(eq(emailSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
