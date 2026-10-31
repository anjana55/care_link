import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { useColors, type Colors } from '@/theme';
import { fontFamilyFor } from './fonts';
import { Text } from './Text';

/** A full screen with the app's background and side margins. */
export function Screen({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 }}>{children}</SafeAreaView>;
}

interface ButtonProps {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'link';
  busy?: boolean;
  disabled?: boolean;
}

/** At least 48 pt tall, as accessibility guidelines ask for touch targets. */
export function Button({ label, onPress, variant = 'primary', busy = false, disabled = false }: ButtonProps) {
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
        <Text style={variant === 'primary' ? styles.primaryText : variant === 'secondary' ? styles.secondaryText : styles.linkText}>{label}</Text>
      )}
    </Pressable>
  );
}

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string | null;
}

/** A labelled text field; the label is also what a screen reader announces. */
export function Field({ label, hint, error, ...input }: FieldProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { locale } = useTranslation();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.muted}
        style={[styles.input, error ? styles.inputError : null, { fontFamily: fontFamilyFor(locale, false) }]}
        {...input}
      />
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
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

const button = { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 } as const;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    primary: { ...button, backgroundColor: colors.brand },
    secondary: { ...button, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand },
    link: { minHeight: 48, justifyContent: 'center' },
    primaryText: { fontSize: 17, fontWeight: '600', color: colors.brandText, textAlign: 'center' },
    secondaryText: { fontSize: 17, fontWeight: '600', color: colors.brand, textAlign: 'center' },
    linkText: { fontSize: 16, fontWeight: '600', color: colors.brand },
    field: { gap: 6 },
    label: { fontSize: 15, fontWeight: '600', color: colors.ink },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      fontSize: 17,
      color: colors.ink,
      backgroundColor: colors.surface,
    },
    inputError: { borderColor: colors.danger },
    hint: { fontSize: 13, color: colors.muted },
    error: { fontSize: 14, color: colors.danger },
  });
