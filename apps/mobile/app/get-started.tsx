import { useMemo } from 'react';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { useColors, type Colors } from '@/theme';
import { PageHeader } from '@/ui/PageHeader';
import { Text } from '@/ui/Text';
import { tint, type IconName } from '@/ui/visual';

/**
 * After Get started: which side of the app this person is on - two big
 * choices. Someone who needs care goes to the client home (searching needs no
 * account; they sign in when they contact or save someone). A caregiver goes
 * to the caregiver sign-in, which also explains how to join. The choice
 * decides the `portal` sent on sign-in, so the API's portal rule still holds.
 */
export default function GetStarted() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <PageHeader title={t('start.title')} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Link href="/start" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={t('start.needCare')} accessibilityHint={t('welcome.findCareHint')} style={styles.primary}>
            <Choice icon="heart" title={t('start.needCare')} hint={t('welcome.findCareHint')} onDeep />
          </Pressable>
        </Link>
        <Link href={{ pathname: '/sign-in', params: { role: 'caregiver' } }} asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={t('start.caregiver')} accessibilityHint={t('welcome.joinHint')} style={styles.secondary}>
            <Choice icon="medkit" title={t('start.caregiver')} hint={t('welcome.joinHint')} />
          </Pressable>
        </Link>
      </ScrollView>
    </View>
  );
}

function Choice({ icon, title, hint, onDeep = false }: { icon: IconName; title: string; hint: string; onDeep?: boolean }) {
  const colors = useColors();
  return (
    <>
      <View style={[choice.icon, { backgroundColor: onDeep ? colors.surface : tint(colors.brand, 0.12) }]}>
        <Ionicons name={icon} size={34} color={onDeep ? colors.deep : colors.brand} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[choice.title, { color: onDeep ? colors.brandText : colors.deep }]}>{title}</Text>
        <Text style={[choice.hint, { color: onDeep ? '#E6EEF3' : colors.muted }]}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={28} color={onDeep ? colors.brandText : colors.muted} />
    </>
  );
}

const choice = StyleSheet.create({
  icon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800' },
  hint: { fontSize: 16, lineHeight: 23 },
});

const card = { minHeight: 132, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 } as const;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, gap: 16 },
    // One flat style each: expo-router's <Link asChild> refuses an array of styles on its child.
    primary: { ...card, backgroundColor: colors.deep },
    secondary: { ...card, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.brand },
  });
