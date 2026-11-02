import { useState, type ComponentProps, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useBranding } from '@/branding/BrandingProvider';
import { useColors, type Colors } from '@/theme';
import { Text } from './Text';

/**
 * The app's visual building blocks: tinted icon badges, cards, avatars, empty
 * states, the brand band at the top of a screen. Colours come from the
 * deployment's branding (theme.ts), so a white-labelled build looks like its
 * own brand without code changes.
 */

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** A colour at some opacity, from a #RRGGBB brand colour: tinted backgrounds that follow the branding. */
export function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Tone = 'brand' | 'accent' | 'danger' | 'muted';
const toneColor = (colors: Colors, tone: Tone) =>
  tone === 'accent' ? colors.accent : tone === 'danger' ? colors.danger : tone === 'muted' ? colors.muted : colors.brand;

/** An icon in a soft circle of its colour. */
export function IconBadge({ name, tone = 'brand', size = 44, solid = false }: { name: IconName; tone?: Tone; size?: number; solid?: boolean }) {
  const colors = useColors();
  const c = toneColor(colors, tone);
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: solid ? c : tint(c, 0.12) }}
    >
      <Ionicons name={name} size={Math.round(size * 0.5)} color={solid ? colors.brandText : c} />
    </View>
  );
}

/** A white card with a soft shadow. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: tint(colors.ink, 0.06) }, style]}>{children}</View>;
}

/** A screen's title, with an icon and a line under it. */
export function ScreenTitle({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: IconName }) {
  const colors = useColors();
  return (
    <View style={styles.titleRow}>
      {icon ? <IconBadge name={icon} size={48} /> : null}
      <View style={{ flex: 1, gap: 4 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {title}
        </Text>
        {subtitle ? <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

/** When a list has nothing in it: a large icon, what it means, and what to do. */
export function EmptyState({ icon, title, body, children }: { icon: IconName; title?: string; body: string; children?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyRing, { backgroundColor: tint(colors.accent, 0.08) }]}>
        <IconBadge name={icon} tone="accent" size={72} />
      </View>
      {title ? <Text style={[styles.emptyTitle, { color: colors.ink }]}>{title}</Text> : null}
      <Text style={[styles.emptyBody, { color: colors.muted }]}>{body}</Text>
      {children ? <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 4 }}>{children}</View> : null}
    </View>
  );
}

/** Initials in a coloured circle - the person's colour stays the same everywhere. */
/** `onBrand`: on the brand colour, where a tint of it wouldn't show - a white disc instead. */
export function Avatar({ name, size = 56, onBrand = false }: { name: string | null | undefined; size?: number; onBrand?: boolean }) {
  const colors = useColors();
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  const hash = [...(name ?? '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const base = hash % 2 ? colors.accent : colors.brand;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: onBrand ? colors.surface : tint(base, 0.16), alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: Math.round(size * 0.38), fontWeight: '700', color: onBrand ? colors.brand : base }}>{initials}</Text>
    </View>
  );
}

/** A small coloured label: a status, "Verified". */
export function Pill({ label, tone = 'brand', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const colors = useColors();
  const c = toneColor(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: tint(c, 0.12) }]}>
      {icon ? <Ionicons name={icon} size={13} color={c} /> : null}
      <Text style={{ fontSize: 12, fontWeight: '700', color: c }}>{label}</Text>
    </View>
  );
}

/** A row in a menu: icon, label, an optional line under it, and a chevron. */
export function MenuRow({ icon, label, detail, onPress, tone = 'brand' }: { icon: IconName; label: string; detail?: string; onPress: () => void; tone?: Tone }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? tint(colors.brand, 0.05) : 'transparent' }]}
    >
      <IconBadge name={icon} tone={tone} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: tone === 'danger' ? colors.danger : colors.ink }}>{label}</Text>
        {detail ? <Text style={{ fontSize: 13, color: colors.muted }}>{detail}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** A thin line between menu rows. */
export function Divider() {
  const colors = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 68 }} />;
}

/**
 * The brand's symbol (Settings > Branding): the square mark, else the shipped
 * heart in the accent colour. `light` puts it on a white tile, for the brand
 * colour.
 */
export function BrandMark({ size = 56, light = false }: { size?: number; light?: boolean }) {
  const { assetUrl, branding } = useBranding();
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const url = failed ? null : assetUrl('symbol', size > 96 ? 384 : 192);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={branding.companyName}
      style={{ width: size, height: size, borderRadius: size * 0.28, alignItems: 'center', justifyContent: 'center', backgroundColor: light ? colors.surface : tint(colors.accent, 0.12) }}
    >
      {url ? (
        <Image testID="brand-art" source={{ uri: url }} style={{ width: size * 0.78, height: size * 0.78 }} resizeMode="contain" onError={() => setFailed(true)} />
      ) : (
        <Ionicons name="heart" size={size * 0.55} color={colors.accent} />
      )}
    </View>
  );
}

/**
 * The brand's logo, as wide as it is (Settings > Branding). `reverse` is for
 * the brand colour: the reverse logo there, the full-colour one elsewhere.
 * Without the artwork - or if it can't load - the symbol and the company
 * name stand in, so a deployment without artwork still looks finished.
 */
export function BrandLogo({ reverse = false, height = 44, name }: { reverse?: boolean; height?: number; name?: string }) {
  const { assetUrl, branding } = useBranding();
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const url = failed ? null : assetUrl(reverse ? 'logoReverse' : 'logo', 512);
  if (url) {
    return (
      <Image
        testID="brand-art"
        source={{ uri: url }}
        style={{ height, width: height * 5, alignSelf: 'flex-start' }}
        resizeMode="contain"
        accessibilityLabel={branding.companyName}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <BrandMark size={Math.round(height * 1.15)} light={reverse} />
      <Text style={{ fontSize: Math.round(height * 0.66), fontWeight: '700', color: reverse ? colors.brandText : colors.brand }}>{name ?? branding.companyName}</Text>
    </View>
  );
}

/**
 * The brand band at the top of a screen: the brand colour, curved at the
 * bottom, with soft circles for depth. Content sits on it in white.
 */
export function HeroBand({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View style={[styles.hero, { backgroundColor: colors.brand }, style]}>
      <View pointerEvents="none" style={[styles.blob, { width: 220, height: 220, top: -80, right: -60, backgroundColor: tint(colors.accent, 0.35) }]} />
      <View pointerEvents="none" style={[styles.blob, { width: 140, height: 140, bottom: -50, left: -40, backgroundColor: tint('#FFFFFF', 0.08) }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 8 },
  emptyRing: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 19, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
  hero: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32, paddingHorizontal: 24, paddingBottom: 28, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999 },
});
