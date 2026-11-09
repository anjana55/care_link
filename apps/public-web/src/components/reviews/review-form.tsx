'use client';

import { useState } from 'react';
import Link from 'next/link';
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
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { StarPicker } from './stars';

/** Toggle chips: a group of buttons that each say whether they are chosen. */
function ChipGroup<T extends string>({ label, hint, options, chosen, onToggle, labelOf }: {
  label: string;
  hint: string;
  options: readonly T[];
  chosen: T[];
  onToggle: (v: T) => void;
  labelOf: (v: T) => string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <p className="text-xs text-ink/60">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = chosen.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o)}
              className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                on ? 'border-accent bg-accent text-white' : 'border-border bg-white text-ink/80 hover:border-accent'
              }`}
            >
              {on ? '✓ ' : ''}
              {labelOf(o)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * The rating itself: stars, then praise badges (4-5 stars) or "could be
 * better" tags (1-3, private), an optional written review and a private note.
 * Checked here as the API checks it, so the client hears about a problem
 * before sending rather than after.
 */
export function ReviewForm({
  existing,
  pending,
  error,
  reportHref,
  onSubmit,
}: {
  existing: MyReview | null;
  pending: boolean;
  error: string | null;
  /** Where "Report a problem" goes, shown with a low rating. */
  reportHref: string;
  onSubmit: (body: ReviewSubmitBody) => void;
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [badges, setBadges] = useState<ReviewBadge[]>(existing?.badges ?? []);
  const [tags, setTags] = useState<ReviewImprovementTag[]>(existing?.improvementTags ?? []);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [note, setNote] = useState(existing?.privateNote ?? '');
  const [tried, setTried] = useState(false);

  const praise = rating >= PRAISE_MIN_RATING;
  const text = comment.trim();
  const problems = {
    stars: !rating ? t('reviews.form.chooseStars') : null,
    comment:
      text && text.length < MIN_REVIEW_COMMENT
        ? t('reviews.form.commentTooShort', { min: MIN_REVIEW_COMMENT })
        : findContactDetails(text)
          ? t('reviews.form.contactDetails')
          : null,
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problems.stars || problems.comment) return;
    onSubmit({
      rating,
      badges: praise ? badges : [],
      improvementTags: praise ? [] : tags,
      comment: text || null,
      privateNote: note.trim() || null,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-ink">{t('reviews.form.starsQuestion')}</p>
        <StarPicker value={rating} onChange={setRating} invalid={tried && Boolean(problems.stars)} />
        {tried && problems.stars && (
          <p role="alert" className="text-sm text-danger">
            {problems.stars}
          </p>
        )}
      </div>

      {rating > 0 && praise && (
        <ChipGroup
          label={t('reviews.form.praiseQuestion')}
          hint={t('reviews.form.optional')}
          options={REVIEW_BADGES}
          chosen={badges}
          onToggle={(b) => setBadges((l) => toggle(l, b))}
          labelOf={(b) => t(`reviews.badge.${b}`)}
        />
      )}
      {rating > 0 && !praise && (
        <div className="space-y-2">
          <ChipGroup
            label={t('reviews.form.improveQuestion')}
            hint={`${t('reviews.form.optional')}. ${t('reviews.form.privateHint')}`}
            options={REVIEW_IMPROVEMENT_TAGS}
            chosen={tags}
            onToggle={(v) => setTags((l) => toggle(l, v))}
            labelOf={(v) => t(`reviews.tag.${v}`)}
          />
          <Link href={reportHref} className="inline-block text-sm font-medium text-brand hover:underline">
            {t('reviews.form.reportProblem')}
          </Link>
        </div>
      )}

      <div>
        <label htmlFor="review-comment" className="text-sm font-semibold text-ink">
          {t('reviews.form.commentLabel')}
        </label>
        <p id="review-comment-hint" className="text-xs text-ink/60">
          {t('reviews.form.commentHint')}
        </p>
        <textarea
          id="review-comment"
          rows={4}
          maxLength={MAX_REVIEW_COMMENT}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('reviews.form.commentPlaceholder')}
          aria-describedby="review-comment-hint review-comment-error"
          aria-invalid={tried && Boolean(problems.comment)}
          className="mt-2 w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-base text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <div className="flex justify-between gap-3 text-xs">
          <span id="review-comment-error" role={tried && problems.comment ? 'alert' : undefined} className="text-danger">
            {tried ? problems.comment : ''}
          </span>
          <span className="tabular-nums text-ink/50">{t('reviews.form.characters', { count: comment.length, max: MAX_REVIEW_COMMENT })}</span>
        </div>
      </div>

      <div>
        <label htmlFor="review-note" className="text-sm font-semibold text-ink">
          {t('reviews.form.privateNoteLabel')}
        </label>
        <p className="text-xs text-ink/60">{t('reviews.form.privateHint')}</p>
        <textarea
          id="review-note"
          rows={2}
          maxLength={MAX_REVIEW_PRIVATE_NOTE}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-2 w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-base text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-DEFAULT bg-danger-light px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? t('reviews.form.saving') : existing ? t('reviews.form.update') : t('reviews.form.submit')}
      </Button>
    </form>
  );
}
