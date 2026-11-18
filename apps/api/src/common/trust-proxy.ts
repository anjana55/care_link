/**
 * The Express "trust proxy" value from TRUST_PROXY. Unset: the loopback and
 * private networks (nginx in Docker). "false"/"0": none. A number: that many
 * hops. Anything else: a comma-separated list of addresses or ranges.
 */
export function trustProxy(value: string | undefined): string | number | boolean {
  const v = value?.trim();
  if (!v) return 'loopback, linklocal, uniquelocal';
  if (v === 'false' || v === '0') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
