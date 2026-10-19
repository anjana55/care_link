/**
 * Outgoing message texts (email, WhatsApp) name the company with a `{brand}`
 * placeholder rather than a hardcoded product name, so a white-labelled
 * deployment speaks with its own name. The placeholder is filled at the last
 * moment - in EmailService and WhatsappProviderService - from Settings >
 * Branding, so no message builder needs to know the name.
 */
export const BRAND_PLACEHOLDER = /\{brand\}/g;

export function withBrand(text: string, brandName: string): string {
  return text.replace(BRAND_PLACEHOLDER, () => brandName);
}
