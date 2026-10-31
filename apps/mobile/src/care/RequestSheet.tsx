import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { CARE_REQUEST_MESSAGE_MAX, careTypeValues, colomboToday, type CareType, type ClientCareRequest, type CreateCareRequestBody } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, FormError } from '@/ui/controls';
import { Chips, SelectField } from '@/ui/choices';
import { fontFamilyFor } from '@/ui/fonts';
import { Text } from '@/ui/Text';
import { useCities, useDistricts } from '@/search/api';
import { startDateChoices } from '@/search/NormalSearchForm';
import { useSendRequest } from './api';
import { detailsFromLastSearch } from './last-search';

/**
 * Sends a care request for a signed-in client, as on the website. Contact goes
 * through staff: our team calls both sides, and the sheet says so up front.
 *
 * - With a caregiver ("Contact this caregiver"): just an optional note; what
 *   the client last searched for rides along.
 * - Without one ("Find a caregiver for me"): the type of care and the district
 *   are needed (prefilled from the last search), and our team finds someone.
 */
export function RequestSheet({
  visible,
  caregiverPublicId,
  onClose,
  onViewRequests,
}: {
  visible: boolean;
  caregiverPublicId?: string;
  onClose: () => void;
  onViewRequests: () => void;
}) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const send = useSendRequest();
  const findForMe = !caregiverPublicId;
  const prefix = findForMe ? 'care.findDialog' : 'care.dialog';

  const [message, setMessage] = useState('');
  const [careType, setCareType] = useState<CareType | null>(null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState<ClientCareRequest | null>(null);
  const districts = useDistricts(locale);
  const cities = useCities(findForMe ? districtId : null, locale);

  // A fresh sheet every time it opens, prefilled from the last search.
  useEffect(() => {
    if (!visible) return;
    const last = detailsFromLastSearch();
    setMessage('');
    setCareType(last.careType ?? null);
    setDistrictId(last.districtId ?? null);
    setCityId(last.cityId ?? null);
    setStartDate(last.desiredStartDate ?? null);
    setTried(false);
    setSent(null);
    send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const missingCareType = findForMe && !careType;
  const missingDistrict = findForMe && !districtId;
  const tooLong = message.length > CARE_REQUEST_MESSAGE_MAX;

  const submit = () => {
    setTried(true);
    if (missingCareType || missingDistrict || tooLong || send.isPending) return;
    const note = message.trim() || undefined;
    const body: CreateCareRequestBody = findForMe
      ? {
          ...(note ? { message: note } : {}),
          careType: careType!,
          districtId: districtId!,
          ...(cityId ? { cityId } : {}),
          ...(startDate ? { desiredStartDate: startDate } : {}),
        }
      : { caregiverPublicId, ...(note ? { message: note } : {}), ...detailsFromLastSearch() };
    send.mutate(body, { onSuccess: setSent });
  };

  const error = send.error instanceof ApiError && send.error.message ? send.error.message : send.error ? t('care.dialog.error') : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        {sent ? (
          <View accessibilityLiveRegion="polite" style={styles.done}>
            <Text style={{ fontSize: 44, color: colors.brand }}>✓</Text>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink, textAlign: 'center' }]}>
              {t(`${prefix}.successTitle`)}
            </Text>
            <Text style={[styles.body, { color: colors.muted, textAlign: 'center' }]}>{t(`${prefix}.successBody`, { reference: sent.reference })}</Text>
            <Button label={t('care.viewRequests')} onPress={onViewRequests} />
            <Button variant="secondary" label={t('care.dialog.close')} onPress={onClose} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
              {t(`${prefix}.title`)}
            </Text>
            <Text style={[styles.body, { color: colors.muted }]}>{t(`${prefix}.intro`)}</Text>

            {findForMe ? (
              <>
                <Chips
                  label={t('normalSearch.careType')}
                  choices={careTypeValues.map((v) => ({ value: v, label: t(`careTypes.${v}`) }))}
                  selected={careType ? [careType] : []}
                  onToggle={setCareType}
                  error={tried && missingCareType ? t('care.findDialog.careTypeRequired') : null}
                />
                <SelectField
                  label={t('normalSearch.district')}
                  choices={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
                  value={districtId}
                  onChange={(id) => {
                    setDistrictId(id);
                    setCityId(null);
                  }}
                  none={t('care.findDialog.choose')}
                  error={tried && missingDistrict ? t('care.findDialog.districtRequired') : null}
                />
                <SelectField
                  label={t('normalSearch.city')}
                  choices={(cities.data ?? []).map((c) => ({ value: c.id, label: c.subName ? `${c.name} (${c.subName})` : c.name }))}
                  value={cityId}
                  onChange={setCityId}
                  none={t('normalSearch.anyCity')}
                  disabled={!districtId}
                />
                <Chips
                  label={t('normalSearch.startDate')}
                  choices={startDateChoices(colomboToday(), locale)}
                  selected={startDate ? [startDate] : []}
                  onToggle={(d) => setStartDate((cur) => (cur === d ? null : d))}
                />
              </>
            ) : null}

            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: colors.ink }]}>{t(`${prefix}.messageLabel`)}</Text>
              <TextInput
                accessibilityLabel={t(`${prefix}.messageLabel`)}
                value={message}
                onChangeText={setMessage}
                placeholder={t(`${prefix}.messagePlaceholder`)}
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, { borderColor: tooLong ? colors.danger : colors.border, backgroundColor: colors.surface, color: colors.ink, fontFamily: fontFamilyFor(locale, false) }]}
              />
              <Text style={{ fontSize: 13, color: tooLong ? colors.danger : colors.muted }}>
                {t('care.dialog.charsLeft', { count: CARE_REQUEST_MESSAGE_MAX - message.length })}
              </Text>
            </View>

            <FormError message={error} />
            <Button label={send.isPending ? t('care.dialog.sending') : t(`${prefix}.send`)} onPress={submit} busy={send.isPending} disabled={tooLong} />
            <Button variant="secondary" label={t('care.dialog.cancel')} onPress={onClose} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 40, gap: 18 },
  done: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 15, fontWeight: '600' },
  input: { minHeight: 110, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17, textAlignVertical: 'top' },
});
