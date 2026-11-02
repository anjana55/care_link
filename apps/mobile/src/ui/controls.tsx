import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { IconName } from './visual';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { useColors, type Colors } from '@/theme';
import { fontFamilyFor } from './fonts';
import { PageHeader } from './PageHeader';
import { Text } from './Text';

/**
 * A full screen with the app's background and side margins, under the page
 * header (Back, Home and the title). `header={false}` only for screens that
 * are never really seen, such as the sign-in return.
 */
export function Screen({
  children,
  title,
  subtitle,
  isHome = false,
  header = true,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  isHome?: boolean;
  header?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header ? <PageHeader title={title} subtitle={subtitle} isHome={isHome} /> : null}
      <SafeAreaView edges={header ? ['bottom', 'left', 'right'] : undefined} style={{ flex: 1, paddingHorizontal: 24 }}>
        {children}
      </SafeAreaView>
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'link';
  busy?: boolean;
  disabled?: boolean;
  /** A picture before the label. */
  icon?: IconName;
}

/** At least 48 pt tall, as accessibility guidelines ask for touch targets. */
export function Button({ label, onPress, variant = 'primary', busy = false, disabled = false, icon }: ButtonProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole={variant === 'link' ? 'link' : 'button'}
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={label}
      disabled={off}
      onPress={onPress}
      style={variant === 'primary' ? styles.primary : variant === 'secondary' ? styles.secondary : styles.link}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? colors.brandText : colors.brand} />
      ) : (
        <View style={styles.buttonRow}>
          {icon ? <Ionicons name={icon} size={22} color={variant === 'primary' ? colors.brandText : colors.brand} /> : null}
          <Text style={variant === 'primary' ? styles.primaryText : variant === 'secondary' ? styles.secondaryText : styles.linkText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Something to show at the end of the box, such as a show-password button. */
  accessory?: ReactNode;
}

/** A labelled text field; the label is also what a screen reader announces. */
export function Field({ label, hint, error, accessory, ...input }: FieldProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { locale } = useTranslation();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, error ? styles.inputError : null]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={colors.muted}
          style={[styles.input, { fontFamily: fontFamilyFor(locale, false) }]}
          {...input}
        />
        {accessory}
      </View>
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A password box with a button to show what was typed, so a person can check
 * it before signing in. Never capitalised or auto-corrected by the keyboard.
 */
export function PasswordField(props: Omit<FieldProps, 'accessory' | 'secureTextEntry'>) {
  const { t } = useTranslation();
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  return (
    <Field
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      accessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(visible ? 'common.hidePassword' : 'common.showPassword')}
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 12, justifyContent: 'center' }}
        >
          <Text style={{ color: colors.brand, fontSize: 15, fontWeight: '600' }}>{t(visible ? 'common.hidePassword' : 'common.showPassword')}</Text>
        </Pressable>
      }
    />
  );
}

/** A message for the whole form (a refused sign-in, no connection). */
export function FormError({ message }: { message: string | null }) {
  const colors = useColors();
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15, lineHeight: 22 }}>
      {message}
    </Text>
  );
}

/** Big and easy to hit: many of the app's people are older or new to smartphones. */
const button = { minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 } as const;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    primary: { ...button, backgroundColor: colors.deep },
    secondary: { ...button, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.brand },
    link: { minHeight: 48, justifyContent: 'center' },
    buttonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    primaryText: { fontSize: 18, fontWeight: '700', color: colors.brandText, textAlign: 'center' },
    secondaryText: { fontSize: 18, fontWeight: '700', color: colors.brand, textAlign: 'center' },
    linkText: { fontSize: 17, fontWeight: '700', color: colors.brand },
    field: { gap: 6 },
    label: { fontSize: 16, fontWeight: '700', color: colors.ink },
    box: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    input: { flex: 1, minHeight: 54, paddingHorizontal: 16, fontSize: 18, color: colors.ink },
    inputError: { borderColor: colors.danger },
    hint: { fontSize: 15, color: colors.muted },
    error: { fontSize: 14, color: colors.danger },
  });
