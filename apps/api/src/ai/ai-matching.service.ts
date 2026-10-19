import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import {
  resolveLocale,
  type AiSearchResponse,
  type ExtractedRequirements,
  type Locale,
  type SearchRequest,
  type StaffCaregiverSuggestion,
  type StaffSuggestionsResponse,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { careRequests, caregivers, cities, districts, languages, patients, skills } from '../database/schema';
import { PublicSearchService, type RankedPool } from '../public-search/public-search.service';
import type { SearchRequestDto } from '../public-search/dto/search-request.dto';
import { AiSettingsService, type ResolvedAiSettings } from './ai-settings.service';
import { AiProviderService, AiUnavailableError } from './ai-provider.service';
import { parseJsonObject } from './ai-protocol';
import { extractionPrompt, normalizeExtraction, summarize, todayInColombo, type Catalog } from './requirements';
import { applyRanking, candidateCard, rerankPrompt } from './rerank';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

const SCHEDULE_TO_SHIFT = { DAY: 'DAY', NIGHT: 'NIGHT', LIVE_IN_24H: 'TWENTY_FOUR_HOUR_LIVE_IN' } as const;

/**
 * Every AI matching path: the public AI Search (extract, then re-rank) and the
 * staff "Suggest caregivers" panel. All of them start from the same
 * deterministic, hard-filtered pool PublicSearchService builds for Normal
 * Search, and the model only ever reorders a bounded slice of it.
 */
@Injectable()
export class AiMatchingService {
  private readonly logger = new Logger(AiMatchingService.name);
  /** Re-ranked orders by request, so paging through AI results does not call the model again. */
  private readonly cache = new Map<string, { at: number; order: string[]; reasons: Map<string, string>; aiRanked: boolean }>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly settings: AiSettingsService,
    private readonly provider: AiProviderService,
    private readonly search: PublicSearchService,
  ) {}

  async publicSearchEnabled(): Promise<boolean> {
    return Boolean(await this.settings.forFeature('publicSearch'));
  }

  // --- catalogue ---------------------------------------------------------------

  async catalog(locale: Locale): Promise<Catalog> {
    const [skillRows, languageRows, districtRows] = await Promise.all([
      this.db.select({ id: skills.id, name: skills.name }).from(skills).orderBy(skills.name),
      this.db.select({ id: languages.id, name: languages.name }).from(languages).orderBy(languages.name),
      this.db.select().from(districts).orderBy(districts.nameEn),
    ]);
    return {
      skills: skillRows,
      languages: languageRows,
      districts: districtRows.map((d) => ({ id: d.id, name: d.nameEn, localName: locale === 'si' ? d.nameSi : locale === 'ta' ? d.nameTa : d.nameEn })),
    };
  }

  private async resolveCity(districtId: number, name: string, locale: Locale): Promise<{ id: number; label: string } | null> {
    const needle = name.toLowerCase();
    const [row] = await this.db
      .select()
      .from(cities)
      .where(
        and(
          eq(cities.districtId, districtId),
          or(sql`LOWER(${cities.nameEn}) = ${needle}`, eq(cities.nameSi, name), eq(cities.nameTa, name)),
        ),
      )
      .limit(1);
    if (!row) return null;
    return { id: row.id, label: locale === 'si' ? row.nameSi : locale === 'ta' ? row.nameTa : row.nameEn };
  }

  // --- extraction ----------------------------------------------------------------

  /** Free text -> a validated search request. Throws AiUnavailableError if the model cannot be used. */
  async extract(settings: ResolvedAiSettings, text: string, locale: Locale): Promise<ExtractedRequirements> {
    const catalog = await this.catalog(locale);
    const today = todayInColombo();
    const reply = await this.provider.chat(settings, {
      json: true,
      temperature: settings.temperature === null ? null : Math.min(settings.temperature, 0.3),
      messages: [
        { role: 'system', content: extractionPrompt(catalog, today, settings.searchPrompt) },
        { role: 'user', content: text.slice(0, 2000) },
      ],
    });
    const { request, cityName } = normalizeExtraction(parseJsonObject(reply.content), catalog, today);
    let cityLabel: string | null = null;
    if (cityName && request.location?.districtId) {
      const city = await this.resolveCity(request.location.districtId, cityName, locale);
      if (city) {
        request.location = { ...request.location, cityId: city.id };
        cityLabel = city.label;
      }
    }
    request.locale = locale;
    return { requirements: request, summary: summarize(request, catalog, locale, cityLabel) };
  }

  async publicExtract(query: string, locale?: string): Promise<ExtractedRequirements> {
    const settings = await this.settings.forFeature('publicSearch');
    if (!settings) throw new ServiceUnavailableException('AI search is not available right now - please use the search form');
    try {
      return await this.extract(settings, query, resolveLocale(locale));
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        throw new ServiceUnavailableException('AI search is not available right now - please use the search form');
      }
      throw err;
    }
  }

  // --- re-ranking --------------------------------------------------------------

  /**
   * Re-ranks the top of a pool. Never throws for model trouble: on any failure
   * the deterministic order stands and `aiRanked` says so.
   */
  private async rerank(
    settings: ResolvedAiSettings,
    pool: RankedPool,
    needs: string,
    locale: Locale,
  ): Promise<{ order: string[]; reasons: Map<string, string>; aiRanked: boolean; error: string | null }> {
    const originalOrder = pool.ranked.map((r) => r.caregiverId);
    const slice = originalOrder.slice(0, settings.candidatePoolSize);
    if (slice.length < 2) return { order: originalOrder, reasons: new Map(), aiRanked: false, error: null };

    const handles = new Map<string, string>();
    const cards: string[] = [];
    slice.forEach((id, i) => {
      const summary = this.search.summaryOf(pool, id);
      if (!summary) return;
      const handle = `C${i + 1}`;
      handles.set(handle, id);
      cards.push(candidateCard(handle, summary));
    });

    try {
      const reply = await this.provider.chat(settings, {
        json: true,
        messages: [
          { role: 'system', content: rerankPrompt(locale, settings.searchPrompt) },
          { role: 'user', content: `Family's needs:\n${needs.slice(0, 2500)}\n\nCandidates:\n${cards.join('\n\n')}` },
        ],
      });
      const applied = applyRanking(parseJsonObject(reply.content), handles, slice);
      if (!applied.used) return { order: originalOrder, reasons: new Map(), aiRanked: false, error: 'The AI reply could not be read' };
      return { order: [...applied.order, ...originalOrder.slice(slice.length)], reasons: applied.reasons, aiRanked: true, error: null };
    } catch (err) {
      if (err instanceof AiUnavailableError) return { order: originalOrder, reasons: new Map(), aiRanked: false, error: err.message };
      throw err;
    }
  }

  /** The structured request, written out for the model alongside the family's own words. */
  private describeRequest(request: SearchRequest, catalog: Catalog): string {
    const s = summarize(request, catalog, 'en', null);
    return [...s.patient, ...s.location, ...s.care, ...s.preferences].join('; ');
  }

  async publicSearch(request: SearchRequestDto, query: string): Promise<AiSearchResponse> {
    const settings = await this.settings.forFeature('publicSearch');
    const pool = await this.search.rankedPool(request);
    if (!settings || !pool.ranked.length) return { ...this.search.toPage(pool, request), aiRanked: false };

    const locale = resolveLocale(request.locale);
    const { page, pageSize, ...rest } = request;
    const key = createHash('sha256').update(JSON.stringify({ rest, query, model: settings.model, at: settings.updatedAt })).digest('hex');
    const ids = pool.ranked.map((r) => r.caregiverId).sort().join(',');

    let entry = this.cache.get(key);
    // A cached order is only reused while the pool is the same people - a
    // caregiver booked or suspended in between must not reappear from cache.
    if (!entry || Date.now() - entry.at > CACHE_TTL_MS || [...entry.order].sort().join(',') !== ids) {
      const catalog = await this.catalog(locale);
      const needs = `${query}\n\nStructured: ${this.describeRequest(request, catalog)}`;
      const result = await this.rerank(settings, pool, needs, locale);
      entry = { at: Date.now(), order: result.order, reasons: result.reasons, aiRanked: result.aiRanked };
      if (result.aiRanked) this.remember(key, entry);
    }
    return { ...this.search.toPage(pool, request, { order: entry.order, reasons: entry.reasons }), aiRanked: entry.aiRanked };
  }

  private remember(key: string, entry: { at: number; order: string[]; reasons: Map<string, string>; aiRanked: boolean }) {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, entry);
  }

  // --- staff suggestions -------------------------------------------------------

  /**
   * Caregivers for a care request, built from the client's intake (where,
   * which shift, caregiver gender, the care recipient) and - when AI matching
   * is on - what their care-needs text and request message say.
   */
  async suggestForRequest(requestId: string, limit = 10): Promise<StaffSuggestionsResponse> {
    const [row] = await this.db
      .select({ request: careRequests, patient: patients })
      .from(careRequests)
      .innerJoin(patients, eq(careRequests.patientId, patients.id))
      .where(eq(careRequests.id, requestId))
      .limit(1);
    if (!row) throw new NotFoundException('Request not found');
    const { request: careRequest, patient } = row;

    const base: SearchRequest = { page: 1, pageSize: limit, locale: 'en' };
    if (patient.districtId) base.location = { districtId: patient.districtId, ...(patient.cityId ? { cityId: patient.cityId } : {}) };
    if (patient.careSchedule && patient.careSchedule !== 'NOT_SURE') base.shift = SCHEDULE_TO_SHIFT[patient.careSchedule];
    if (patient.preferredCaregiverGender === 'MALE' || patient.preferredCaregiverGender === 'FEMALE') {
      base.caregiverGenderPreference = patient.preferredCaregiverGender;
    }
    if (patient.recipientAge || patient.recipientGender === 'MALE' || patient.recipientGender === 'FEMALE') {
      base.patient = {
        ...(patient.recipientAge ? { age: patient.recipientAge } : {}),
        ...(patient.recipientGender === 'MALE' || patient.recipientGender === 'FEMALE' ? { gender: patient.recipientGender } : {}),
      };
    }

    const needsText = [patient.careNeeds, careRequest.message].filter((t): t is string => Boolean(t?.trim())).join('\n\n');
    return this.suggest(base, needsText, limit);
  }

  /**
   * The shared core of staff suggestions: optionally enrich `base` from free
   * text, find the pool, optionally re-rank, and name the people (staff side).
   * Skills read from the text become ranking preferences, never hard filters -
   * staff would rather see a near match than an empty list.
   */
  async suggest(base: SearchRequest, needsText: string, limit = 10): Promise<StaffSuggestionsResponse> {
    const settings = await this.settings.forFeature('staffMatching');
    const catalog = await this.catalog('en');
    let request: SearchRequest = { ...base };
    let notice: string | null = null;

    if (settings && needsText) {
      try {
        const { requirements } = await this.extract(settings, needsText, 'en');
        const skillIds = [...new Set([...(requirements.mandatorySkillIds ?? []), ...(requirements.optionalSkillIds ?? [])])];
        request = {
          ...request,
          ...(skillIds.length ? { optionalSkillIds: skillIds } : {}),
          ...(requirements.languageIds?.length ? { languageIds: requirements.languageIds } : {}),
          ...(requirements.patient?.medicalConditions?.length
            ? { patient: { ...request.patient, medicalConditions: requirements.patient.medicalConditions } }
            : {}),
          ...(!request.shift && requirements.shift ? { shift: requirements.shift } : {}),
          ...(!request.caregiverGenderPreference && requirements.caregiverGenderPreference ? { caregiverGenderPreference: requirements.caregiverGenderPreference } : {}),
          ...(!request.location && requirements.location ? { location: requirements.location } : {}),
        };
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) throw err;
        notice = err.message;
      }
    }

    const dto = { ...request, page: 1, pageSize: limit } as SearchRequestDto;
    const pool = await this.search.rankedPool(dto);
    let order = pool.ranked.map((r) => r.caregiverId);
    let reasons = new Map<string, string>();
    let aiRanked = false;
    if (settings && pool.ranked.length > 1) {
      const needs = `${needsText || '(no free-text needs given)'}\n\nStructured: ${this.describeRequest(request, catalog)}`;
      const result = await this.rerank(settings, pool, needs, 'en');
      order = result.order;
      reasons = result.reasons;
      aiRanked = result.aiRanked;
      notice = notice ?? result.error;
    }

    const top = order.slice(0, limit);
    const people = top.length
      ? await this.db
          .select({ id: caregivers.id, fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber })
          .from(caregivers)
          .where(inArray(caregivers.id, top))
      : [];
    const names = new Map(people.map((p) => [p.id, p]));

    const items: StaffCaregiverSuggestion[] = top.flatMap((id) => {
      const s = this.search.summaryOf(pool, id);
      const person = names.get(id);
      if (!s || !person) return [];
      return [
        {
          caregiverId: id,
          fullName: person.fullName,
          registrationNumber: person.registrationNumber,
          gender: s.gender,
          district: s.district,
          city: s.city,
          yearsExperience: s.yearsExperience,
          skills: s.skills.map((k) => k.name),
          languages: s.languages.map((l) => l.name),
          hasVerifiedQualification: s.hasVerifiedQualification,
          dayDuty: s.availability.dayDuty,
          nightDuty: s.availability.nightDuty,
          liveIn24h: s.availability.liveIn24h,
          score: s.matchScore ?? 0,
          reasons: s.matchReasons ?? [],
          aiReason: reasons.get(id) ?? null,
        },
      ];
    });

    const s = summarize(request, catalog, 'en', null);
    return { criteria: [...s.patient, ...s.location, ...s.care, ...s.preferences], items, aiRanked, notice };
  }
}
