/**
 * Public, secret-free view of WhatsApp sign-in availability, returned by
 * GET /auth/whatsapp/config. The sign-in screens use it to decide whether to
 * offer the WhatsApp option at all and how to lay out the code-entry step.
 * Credentials, templates and the rest of the admin-managed settings are
 * deliberately not part of this contract.
 */
export interface WhatsappRoleAvailability {
  register: boolean;
  login: boolean;
  recovery: boolean;
}

export interface WhatsappPublicConfig {
  enabled: boolean;
  caregiver: WhatsappRoleAvailability;
  customer: WhatsappRoleAvailability;
  otpLength: number;
  otpTtlSeconds: number;
  resendCooldownSeconds: number;
  defaultCountryCode: string;
}

export type WhatsappOtpPurpose = 'REGISTER' | 'LOGIN' | 'RECOVERY';
