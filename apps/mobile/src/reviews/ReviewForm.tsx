import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  MAX_REVIEW_COMMENT,
  MAX_REVIEW_PRIVATE_NOTE,
  MIN_REVIEW_COMMENT,
  PRAISE_MIN_RATING,
  REVIEW_BADGES,
  REVIEW_IMPROVEMENT_TAGS,
  findContactDetails,
  type MyReview,
  type ReviewBadge,
  type ReviewImprovementTag,
  type ReviewSubmitBody,
} from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { StarPicker } from './Stars';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Big toggle chips that say whether they are chosen. */
function Chips<T extends string>({ title, hint, options, chosen, onToggle, labelOf }: {
  title: string;
  hint: string;
  options: readonly T[];
  chosen: T[];
  onToggle: (v: T) => void;
  labelOf: (v: T) => string;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{title}</Text>
      <Text style={{ fontSize: 14, color: colors.muted }}>{hint}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const on = chosen.includes(o);
          return (
            <Pressable
              key={o}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={labelOf(o)}
              onPress={() => onToggle(o)}
              style={[styles.chip, { borderColor: on ? colors.deep : colors.border, backgroundColor: on ? colors.deep : colors.surface }]}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: on ? colors.brandText : colors.ink }}>
                {on ? '✓ ' : ''}
                {labelOf(o)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The rating itself, as on the website: stars, then praise badges (4-5) or
 * private "could be better" tags (1-3), an optional review and a private note
 * to the office. Checked here as the API checks it.
 */
export function ReviewForm({
  existing,
  busy,
  error,
  onReport,
  onSubmit,
}: {
  existing: MyReview | null;
  busy: boolean;
  error: string | null;
  /** Opens the booking's "Report a problem", offered with a low rating. */
  onReport: () => void;
  onSubmit: (body: ReviewSubmitBody) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [badges, setBadges] = useState<ReviewBadge[]>(existing?.badges ?? []);
  const [tags, setTags] = useState<ReviewImprovementTag[]>(existing?.improvementTags ?? []);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [note, setNote] = useState(existing?.privateNote ?? '');
  const [tried, setTried] = useState(false);

  const praise = rating >= PRAISE_MIN_RATING;
  const text = comment.trim();
  const starsProblem = !rating ? t('reviews.form.chooseStars') : null;
  const commentProblem =
    text && text.length < MIN_REVIEW_COMMENT ? t('reviews.form.commentTooShort', { min: MIN_REVIEW_COMMENT }) : findContactDetails(text) ? t('reviews.form.contactDetails') : null;

  const submit = () => {
    setTried(true);
    if (starsProblem || commentProblem) return;
    onSubmit({ rating, badges: praise ? badges : [], improvementTags: praise ? [] : tags, comment: text || null, privateNote: note.trim() || null });
  };

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{t('reviews.form.starsQuestion')}</Text>
        <StarPicker value={rating} onChange={setRating} />
        {tried && starsProblem ? <FormError message={starsProblem} /> : null}
      </View>

      {rating > 0 && praise ? (
        <Chips
          title={t('reviews.form.praiseQuestion')}
          hint={t('reviews.form.optional')}
          options={REVIEW_BADGES}
          chosen={badges}
          onToggle={(b) => setBadges((l) => toggle(l, b))}
          labelOf={(b) => t(`reviews.badge.${b}`)}
        />
      ) : null}
      {rating > 0 && !praise ? (
        <View style={{ gap: 8 }}>
          <Chips
            title={t('reviews.form.improveQuestion')}
            hint={`${t('reviews.form.optional')}. ${t('reviews.form.privateHint')}`}
            options={REVIEW_IMPROVEMENT_TAGS}
            chosen={tags}
            onToggle={(v) => setTags((l) => toggle(l, v))}
            labelOf={(v) => t(`reviews.tag.${v}`)}
          />
          <Button variant="link" label={t('reviews.form.reportProblem')} onPress={onReport} />
        </View>
      ) : null}

      <Field
        label={t('reviews.form.commentLabel')}
        hint={t('reviews.form.commentHint')}
        error={tried ? commentProblem : null}
        value={comment}
        onChangeText={setComment}
        placeholder={t('reviews.form.commentPlaceholder')}
        multiline
        maxLength={MAX_REVIEW_COMMENT}
        textAlignVertical="top"
        numberOfLines={5}
      />
      <Field
        label={t('reviews.form.privateNoteLabel')}
        hint={t('reviews.form.privateHint')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={MAX_REVIEW_PRIVATE_NOTE}
        textAlignVertical="top"
      />

      <FormError message={error} />
      <Button label={existing ? t('reviews.form.update') : t('reviews.form.submit')} busy={busy} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, borderWidth: 2, borderRadius: 24, paddingHorizontal: 16, justifyContent: 'center' },
});
