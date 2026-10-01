import { EmailService } from './email.service';

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as any;
}

describe('EmailService', () => {
  it('falls back to logging when SMTP_HOST is unset, without throwing', async () => {
    const service = new EmailService(makeConfig({ NODE_ENV: 'development' }));
    await expect(service.sendVerificationEmail('a@x.com', 'https://x/verify?token=t', 'CAREGIVER')).resolves.toBeUndefined();
  });

  it('never throws even if the underlying transport would reject', async () => {
    // No real SMTP server at this host/port - sendMail is expected to reject
    // internally, and the service must swallow it (see the class comment on
    // sendVerificationEmail: failures are logged, never surfaced to the caller).
    const service = new EmailService(
      makeConfig({ NODE_ENV: 'production', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_FROM: 'CareLink <a@x.com>' }),
    );
    await expect(service.sendVerificationEmail('a@x.com', 'https://x/verify?token=t', 'PATIENT_GUARDIAN')).resolves.toBeUndefined();
  });
});
