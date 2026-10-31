import { useEffect, useState } from 'react';
import { Alert, Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CaregiverDocument } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useMyDocuments, useOpenDocument, useRemoveDocument, useUploadDocument } from '@/caregiver/api';
import { choosePhoto, chooseFile, clearViewedDocuments, takePhoto, type PickOutcome } from '@/caregiver/document-files';
import {
  asksExpiry,
  CHOICES,
  CORE,
  documentTypeFor,
  expiryFrom,
  fileSize,
  hasExpired,
  ID_KINDS,
  isWithdrawable,
  missingCore,
  problemWith,
  type Choice,
  type IdKind,
  type PickedFile,
} from '@/caregiver/documents';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Chips, SelectField } from '@/ui/choices';
import { Button } from '@/ui/controls';
import { formatDate } from '@/ui/dates';
import { Text } from '@/ui/Text';

const YEARS_AHEAD = 20;

/**
 * The caregiver's documents, as on the website: what staff need, an upload
 * (photograph it, or choose a photo or file), and where each one stands.
 * Opening a document downloads it with the sign-in header and shows it in the
 * phone's own viewer; the copy is cleared when this screen closes.
 */
export default function Documents() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const documents = useMyDocuments();
  const upload = useUploadDocument();
  const remove = useRemoveDocument();
  const view = useOpenDocument();

  const [choice, setChoice] = useState<Choice>('identity');
  const [idKind, setIdKind] = useState<IdKind>('NIC');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => clearViewedDocuments, []);

  if (!user) return <Redirect href="/" />;
  if (user.role !== 'CAREGIVER') return <Redirect href="/find" />;

  const pick = async (how: () => Promise<PickOutcome>) => {
    setError(null);
    setNotice(null);
    const outcome = await how();
    if ('canceled' in outcome) return;
    if ('error' in outcome) {
      setError(
        outcome.error === 'cameraDenied'
          ? t('portal.documents.cameraDenied')
          : outcome.error === 'unsupported'
            ? t('portal.documents.unsupported')
            : t('portal.documents.openError'),
      );
      return;
    }
    const problem = problemWith(outcome.file);
    if (problem) {
      setFile(null);
      setError(t(`portal.documents.${problem}`));
      return;
    }
    setFile(outcome.file);
  };

  const withExpiry = asksExpiry(choice, idKind);
  const onUpload = () => {
    setNotice(null);
    if (!file) return setError(t('portal.documents.chooseFile'));
    const expiresOn = withExpiry ? expiryFrom(year, month, day) : null;
    if (expiresOn === 'partial') return setError(t('portal.documents.partDate'));
    if (expiresOn === 'invalid') return setError(t('portal.documents.badDate'));
    setError(null);
    upload.mutate(
      { file, documentType: documentTypeFor(choice, idKind), expiresOn },
      {
        onSuccess: () => {
          setNotice(t('portal.documents.uploaded'));
          setFile(null);
          setYear(null);
          setMonth(null);
          setDay(null);
        },
        onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('portal.saveError')),
      },
    );
  };

  const onView = (doc: CaregiverDocument) => {
    setError(null);
    view.mutate(
      { id: doc.id, mimeType: doc.mimeType, title: t(`portal.documents.types.${doc.documentType}`) },
      { onError: () => setError(t('portal.documents.openError')) },
    );
  };

  const onRemove = (doc: CaregiverDocument) =>
    Alert.alert(t('portal.documents.confirmRemove'), t(`portal.documents.types.${doc.documentType}`), [
      { text: t('issues.cancel'), style: 'cancel' },
      {
        text: t('portal.documents.remove'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          setNotice(null);
          remove.mutate(doc.id, {
            onSuccess: () => setNotice(t('portal.documents.removed')),
            onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('portal.saveError')),
          });
        },
      },
    ]);

  const list = documents.data ?? [];
  const missing = missingCore(list);
  const thisYear = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 4));
  const monthName = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString(locale === 'en' ? 'en-GB' : locale, { month: 'long', timeZone: 'UTC' });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={documents.isRefetching} onRefresh={() => void documents.refetch()} />}
      >
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {t('portal.documents.title')}
          </Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('portal.documents.subtitle')}</Text>
        </View>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
            {t('portal.documents.needed')}
          </Text>
          {CORE.map((item) => {
            const done = documents.isSuccess && !missing.includes(item.label);
            return (
              <View key={item.label} style={styles.row} accessible accessibilityLabel={`${t(`portal.documents.core.${item.label}`)}: ${done ? t('portal.documents.haveIt') : t('portal.documents.missing')}`}>
                <Text style={[styles.tick, done ? { backgroundColor: colors.brand, color: colors.brandText, borderColor: colors.brand } : { borderColor: colors.border, color: 'transparent' }]}>✓</Text>
                <Text style={{ flex: 1, fontSize: 15, color: done ? colors.ink : colors.muted }}>{t(`portal.documents.core.${item.label}`)}</Text>
              </View>
            );
          })}
        </View>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
            {t('portal.documents.add')}
          </Text>
          <SelectField
            label={t('portal.documents.type')}
            choices={CHOICES.map((c) => ({ value: c, label: t(`portal.documents.pick.${c}`) }))}
            value={choice}
            onChange={(v) => v && setChoice(v)}
          />
          {choice === 'identity' ? (
            <Chips
              label={t('portal.documents.idKind')}
              choices={ID_KINDS.map((k) => ({ value: k, label: t(`portal.documents.idKinds.${k}`) }))}
              selected={[idKind]}
              onToggle={setIdKind}
            />
          ) : null}
          {withExpiry ? (
            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: colors.ink }]}>{t('portal.documents.expiresOn')}</Text>
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <SelectField
                    label={t('portal.documents.day')}
                    choices={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
                    value={day}
                    onChange={setDay}
                    none={t('portal.documents.notSet')}
                  />
                </View>
                <View style={{ flex: 1.6 }}>
                  <SelectField
                    label={t('portal.documents.month')}
                    choices={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) }))}
                    value={month}
                    onChange={setMonth}
                    none={t('portal.documents.notSet')}
                  />
                </View>
                <View style={{ flex: 1.2 }}>
                  <SelectField
                    label={t('portal.documents.year')}
                    choices={Array.from({ length: YEARS_AHEAD + 1 }, (_, i) => ({ value: thisYear + i, label: String(thisYear + i) }))}
                    value={year}
                    onChange={setYear}
                    none={t('portal.documents.notSet')}
                  />
                </View>
              </View>
              <Text style={{ fontSize: 13, color: colors.muted }}>{t('portal.documents.expiresHint')}</Text>
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <Button variant="secondary" label={t('portal.documents.takePhoto')} onPress={() => void pick(takePhoto)} />
            <Button variant="secondary" label={t('portal.documents.choosePhoto')} onPress={() => void pick(choosePhoto)} />
            <Button variant="secondary" label={t('portal.documents.chooseFile')} onPress={() => void pick(chooseFile)} />
            <Text style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}>{t('portal.documents.photoTip')}</Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}>{t('portal.documents.fileHint')}</Text>
          </View>

          {file ? (
            <View style={[styles.picked, { borderColor: colors.border }]}>
              {file.mimeType.startsWith('image/') ? <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
              <Text style={{ flex: 1, fontSize: 14, color: colors.ink }}>
                {t('portal.documents.selected', { name: file.name, size: file.size ? fileSize(file.size) : '' })}
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15 }}>
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.brand, fontSize: 15 }}>
              {notice}
            </Text>
          ) : null}
          <Button label={upload.isPending ? t('common.loading') : t('portal.documents.upload')} busy={upload.isPending} disabled={!file} onPress={() => !upload.isPending && onUpload()} />
        </View>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
            {t('portal.documents.yours')}
          </Text>
          {documents.isLoading ? <Text style={{ color: colors.muted }}>{t('common.loading')}</Text> : null}
          {documents.isError ? <Text style={{ color: colors.danger }}>{t('portal.loadError')}</Text> : null}
          {documents.isSuccess && !list.length ? <Text style={{ color: colors.muted, fontSize: 15 }}>{t('portal.documents.none')}</Text> : null}
          {list.map((doc) => (
            <View key={doc.id} style={[styles.doc, { borderTopColor: colors.border }]}>
              <View style={styles.docHead}>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.ink }}>{t(`portal.documents.types.${doc.documentType}`)}</Text>
                <Text
                  style={[
                    styles.badge,
                    doc.verificationStatus === 'REJECTED'
                      ? { color: colors.danger, borderColor: colors.danger }
                      : doc.verificationStatus === 'VERIFIED'
                        ? { color: colors.brand, borderColor: colors.brand }
                        : { color: colors.ink, borderColor: colors.border },
                  ]}
                >
                  {t(`portal.verification.${doc.verificationStatus}`)}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ fontSize: 13, color: colors.muted }}>
                {doc.originalFilename} · {fileSize(doc.sizeBytes)} · {formatDate(doc.createdAt, locale)}
              </Text>
              {doc.expiresOn ? (
                <Text style={{ fontSize: 13, color: hasExpired(doc.expiresOn) ? colors.danger : colors.muted, fontWeight: hasExpired(doc.expiresOn) ? '600' : '400' }}>
                  {t('portal.documents.expires', { date: formatDate(doc.expiresOn, locale) })}
                </Text>
              ) : null}
              {doc.verificationStatus === 'REJECTED' ? <Text style={{ fontSize: 13, color: colors.danger }}>{t('portal.documents.rejectedHint')}</Text> : null}
              <View style={styles.actions}>
                <Button
                  variant="link"
                  label={view.isPending && view.variables?.id === doc.id ? t('common.loading') : t('portal.documents.view')}
                  onPress={() => !view.isPending && onView(doc)}
                />
                {isWithdrawable(doc.verificationStatus) ? (
                  <Button variant="link" label={t('portal.documents.remove')} disabled={remove.isPending} onPress={() => onRemove(doc)} />
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40, gap: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 15, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, textAlign: 'center', fontSize: 13, lineHeight: 20, overflow: 'hidden' },
  dateRow: { flexDirection: 'row', gap: 8 },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 10, padding: 10 },
  thumb: { width: 64, height: 64, borderRadius: 6 },
  doc: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 4 },
  docHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 20 },
});
