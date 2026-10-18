import { EmailService } from './email.service';
import type { EmailSettingsService, ResolvedEmailSettings } from './email-settings.service';

function settings(over: Partial<ResolvedEmailSettings> | Error): EmailSettingsService {
  const base: ResolvedEmailSettings = {
    id: 'default',
    enabled: false,
    usable: false,
    host: null,
    port: 587,
    secure: false,
    username: null,
    password: null,
    fromName: 'CareLink',
    fromAddress: null,
    replyTo: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    getResolved: async () => {
      if (over instanceof Error) throw over;
      return { ...base, ...over };
    },
  } as unknown as EmailSettingsService;
}

describe('EmailService', () => {
  it('falls back to logging when no server is configured, without throwing', async () => {
    const service = new EmailService(settings({}));
    await expect(service.sendVerificationEmail('a@x.com', 'https://x/verify?token=t', 'CAREGIVER')).resolves.toBeUndefined();
  });

  it('never throws even if the underlying transport would reject', async () => {
    // No real SMTP server at this host/port - sendMail is expected to reject
    // internally, and the service must swallow it (see the class comment on
    // sendVerificationEmail: failures are logged, never surfaced to the caller).
    const service = new EmailService(settings({ enabled: true, usable: true, host: '127.0.0.1', port: 1, fromAddress: 'a@x.com' }));
    await expect(service.sendVerificationEmail('a@x.com', 'https://x/verify?token=t', 'PATIENT_GUARDIAN')).resolves.toBeUndefined();
    service.onModuleDestroy();
  });

  it('never throws when the settings cannot be read (e.g. before migrations ran)', async () => {
    const service = new EmailService(settings(new Error("Table 'email_settings' doesn't exist")));
    await expect(service.sendClaimCodeEmail('a@x.com', '123456', 'CG-1', 10)).resolves.toBeUndefined();
    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('reports why a test email failed instead of swallowing it', async () => {
    await expect(new EmailService(settings({})).sendTestEmail('a@x.com')).rejects.toThrow(/server host/);
    const unreachable = new EmailService(settings({ host: '127.0.0.1', port: 1, fromAddress: 'a@x.com' }));
    await expect(unreachable.sendTestEmail('a@x.com')).rejects.toThrow();
  });
});
