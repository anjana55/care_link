import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  AI_FIRST_MAX,
  AI_REPLY_MAX,
  careTypeValues,
  combineTurns,
  lacksCareDetail,
  missingOf,
  understoodNothingIn,
  type CareType,
  type ExtractedRequirements,
  type SearchRequest,
} from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from '@/ui/fonts';
import { Button } from '@/ui/controls';
import { Chips, SelectField } from '@/ui/choices';
import { Text } from '@/ui/Text';
import { searchApi, useDistricts } from './api';

type Entry =
  | { role: 'user'; text: string }
  | { role: 'assistant'; kind: 'ask-care-type'; summary?: ExtractedRequirements['summary'] }
  | { role: 'assistant'; kind: 'ask-location'; retry: boolean; understoodNothing: boolean; summary?: ExtractedRequirements['summary'] }
  | { role: 'assistant'; kind: 'results'; summary?: ExtractedRequirements['summary']; suggestMore: boolean };

/**
 * AI Search as a short conversation, the same as on the website (the rules
 * are shared: @care-platform/shared ai-search.ts). The visitor describes the
 * care in their own words; the type of care and the area are asked for if
 * missing (each with a one-tap answer), and the search runs as soon as both
 * are known. Later messages add detail and search again.
 */
export function AiSearchPanel({
  onSearch,
  onUseNormalSearch,
  onReset,
}: {
  onSearch: (request: SearchRequest, query: string) => void;
  onUseNormalSearch: () => void;
  onReset: () => void;
}) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const [turns, setTurns] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [current, setCurrent] = useState<ExtractedRequirements | null>(null);
  const [draft, setDraft] = useState('');
  // A care type picked with a button: their words may never name it, so it is laid over later extractions.
  const [pickedCareType, setPickedCareType] = useState<CareType | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const { data: districts = [] } = useDistricts(locale);

  function withPickedCareType(result: ExtractedRequirements, picked: CareType | null): ExtractedRequirements {
    if (!picked || result.requirements.careType) return result;
    return {
      ...result,
      requirements: { ...result.requirements, careType: picked },
      summary: { ...result.summary, care: [t(`careTypes.${picked}`), ...result.summary.care] },
      missing: result.missing?.filter((m) => m !== 'careType'),
    };
  }

  /** Asks for the next missing piece, or searches when nothing is missing. */
  function proceed(result: ExtractedRequirements, query: string, prev: Entry[]) {
    const missing = missingOf(result);
    let next: Entry[];
    if (missing.includes('careType')) {
      next = [...prev, { role: 'assistant', kind: 'ask-care-type', summary: result.summary }];
    } else if (missing.includes('location')) {
      next = [
        ...prev,
        {
          role: 'assistant',
          kind: 'ask-location',
          retry: prev.some((e) => e.role === 'assistant' && e.kind === 'ask-location'),
          understoodNothing: understoodNothingIn(result),
          summary: result.summary,
        },
      ];
    } else {
      onSearch(result.requirements, query);
      next = [...prev, { role: 'assistant', kind: 'results', summary: result.summary, suggestMore: lacksCareDetail(result.requirements) }];
    }
    entriesRef.current = next;
    setEntries(next);
  }

  const extract = useMutation({
    mutationFn: (text: string) => searchApi.aiExtract(text, locale),
    onSuccess: (raw, text) => {
      const result = withPickedCareType(raw, pickedCareType);
      setCurrent(result);
      proceed(result, text, entriesRef.current);
    },
  });

  function say(raw: string) {
    const text = raw.trim();
    if (text.length < 2 || extract.isPending) return;
    const nextTurns = [...turns, text];
    setTurns(nextTurns);
    const withUser: Entry[] = [...entriesRef.current, { role: 'user', text }];
    entriesRef.current = withUser;
    setEntries(withUser);
    setDraft('');
    extract.mutate(combineTurns(nextTurns));
  }

  /** The one-tap answer to "where?": no model call needed. */
  function pickDistrict(id: number | null) {
    const district = districts.find((d) => d.id === id);
    if (!district || !current) return;
    const nextTurns = [...turns, district.name];
    const next: ExtractedRequirements = {
      ...current,
      requirements: { ...current.requirements, location: { districtId: district.id } },
      summary: { ...current.summary, location: [district.name] },
      missing: (current.missing ?? []).filter((m) => m !== 'location'),
    };
    setTurns(nextTurns);
    setCurrent(next);
    proceed(next, combineTurns(nextTurns), [...entriesRef.current, { role: 'user', text: district.name }]);
  }

  /** The one-tap answer to "what kind of care?": no model call needed. */
  function pickCareType(type: CareType) {
    if (!current) return;
    const label = t(`careTypes.${type}`);
    const nextTurns = [...turns, label];
    const next = withPickedCareType({ ...current, requirements: { ...current.requirements, careType: undefined } }, type);
    setPickedCareType(type);
    setTurns(nextTurns);
    setCurrent(next);
    proceed(next, combineTurns(nextTurns), [...entriesRef.current, { role: 'user', text: label }]);
  }

  function startOver() {
    setPickedCareType(null);
    setTurns([]);
    entriesRef.current = [];
    setEntries([]);
    setCurrent(null);
    setDraft('');
    extract.reset();
    onReset();
  }

  const lastAssistant = [...entries].reverse().find((e) => e.role === 'assistant');
  const askingCareType = lastAssistant?.kind === 'ask-care-type';
  const askingLocation = lastAssistant?.kind === 'ask-location';
  const started = entries.length > 0;
  const unavailable = extract.error instanceof ApiError && extract.error.status === 503;
  const inputStyle = [styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, fontFamily: fontFamilyFor(locale, false) }];

  if (!started) {
    return (
      <View style={styles.panel}>
        <Text style={[styles.label, { color: colors.ink }]}>{t('aiSearch.label')}</Text>
        <TextInput
          accessibilityLabel={t('aiSearch.label')}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('aiSearch.placeholder')}
          placeholderTextColor={colors.muted}
          multiline
          maxLength={AI_FIRST_MAX}
          style={[...inputStyle, styles.first]}
        />
        <Text style={{ fontSize: 13, fontStyle: 'italic', color: colors.muted }}>{t('aiSearch.example')}</Text>
        <Button label={t('aiSearch.findCaregivers')} onPress={() => say(draft)} disabled={draft.trim().length < 2} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View accessibilityLiveRegion="polite" style={styles.conversation}>
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1;
          if (entry.role === 'user') {
            return (
              <Text key={i} style={[styles.bubble, styles.mine, { backgroundColor: colors.brand, color: colors.brandText }]}>
                {entry.text}
              </Text>
            );
          }
          const lines = entry.summary ? [...entry.summary.patient, ...entry.summary.location, ...entry.summary.care, ...entry.summary.preferences].filter(Boolean) : [];
          return (
            <View key={i} style={[styles.bubble, styles.theirs, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {isLast && lines.length ? (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>{t('aiSearch.extractedTitle')}</Text>
                  <View style={styles.understood}>
                    {lines.map((line, j) => (
                      <Text key={j} style={[styles.chip, { borderColor: colors.border, color: colors.ink }]}>
                        {line}
                      </Text>
                    ))}
                  </View>
                </View>
              ) : null}
              {entry.kind === 'ask-care-type' ? (
                <>
                  <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{t('aiSearch.askCareType')}</Text>
                  {isLast ? (
                    <Chips
                      choices={careTypeValues.map((v) => ({ value: v, label: t(`careTypes.${v}`) }))}
                      selected={[]}
                      onToggle={pickCareType}
                    />
                  ) : null}
                </>
              ) : entry.kind === 'ask-location' ? (
                <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>
                  {entry.retry ? t('aiSearch.askLocationRetry') : entry.understoodNothing ? t('aiSearch.askLocationEmpty') : t('aiSearch.askLocation')}
                </Text>
              ) : (
                <>
                  <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{t('aiSearch.showingMatches')}</Text>
                  {isLast && entry.suggestMore ? <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>{t('aiSearch.suggestMore')}</Text> : null}
                </>
              )}
            </View>
          );
        })}
        {extract.isPending ? (
          <View accessibilityRole="progressbar" style={styles.pending}>
            <ActivityIndicator color={colors.brand} />
            <Text style={{ color: colors.muted }}>{t('loading.extracting')}</Text>
          </View>
        ) : null}
      </View>

      {extract.isError ? (
        <View accessibilityRole="alert" style={{ gap: 4 }}>
          <Text style={{ color: colors.danger, fontSize: 15 }}>{unavailable ? t('aiSearch.unavailable') : t('aiSearch.failed')}</Text>
          <Button variant="link" label={t('aiSearch.useNormalSearch')} onPress={onUseNormalSearch} />
        </View>
      ) : null}

      {askingLocation && districts.length ? (
        <SelectField
          label={t('aiSearch.orPickDistrict')}
          choices={districts.map((d) => ({ value: d.id, label: d.name }))}
          value={null}
          onChange={pickDistrict}
          none={undefined}
        />
      ) : null}

      <View style={styles.reply}>
        <TextInput
          accessibilityLabel={askingLocation || askingCareType ? t('aiSearch.replyLabel') : t('aiSearch.moreDetailsLabel')}
          value={draft}
          onChangeText={setDraft}
          placeholder={askingCareType ? t('aiSearch.careTypeReplyPlaceholder') : askingLocation ? t('aiSearch.replyPlaceholder') : t('aiSearch.moreDetailsPlaceholder')}
          placeholderTextColor={colors.muted}
          maxLength={AI_REPLY_MAX}
          returnKeyType="send"
          onSubmitEditing={() => say(draft)}
          style={[...inputStyle, { flex: 1 }]}
        />
        <Button label={t('aiSearch.send')} onPress={() => say(draft)} disabled={draft.trim().length < 2 || extract.isPending} />
      </View>
      <Button variant="link" label={t('aiSearch.startOver')} onPress={startOver} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  label: { fontSize: 15, fontWeight: '600' },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17 },
  first: { minHeight: 120, textAlignVertical: 'top' },
  conversation: { gap: 10 },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, lineHeight: 22, overflow: 'hidden' },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', borderWidth: 1, borderTopLeftRadius: 4, gap: 8 },
  understood: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 13, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reply: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
