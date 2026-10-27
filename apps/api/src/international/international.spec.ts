import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import sharp from 'sharp';
import { SHARED_PROFILE_CONSENT_VERSION } from '@care-platform/shared';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import type { Database } from '../database/database.module';
import type { StorageService } from '../storage/storage.interface';
import type { PublicSearchService } from '../public-search/public-search.service';
import { preparePublicPhoto } from './profile-photo';
import { SharedProfilesService, firstNameOf, generateSlug } from './shared-profiles.service';
import { TrainingService, localiseProgramme } from './training.service';
import { EmployerEnquiriesService, generateEnquiryReference } from './employer-enquiries.service';
import { InternationalNotifier } from './international-notifier.service';
import { CaregiverInternationalController, PublicInternationalController } from './international.controllers';

/**
 * A stand-in for Drizzle: every chain (select/insert/update ...) resolves to
 * the next queued result, and every insert/update records what it was given.
 * Enough to drive the services' decisions - which rows they read, what they
 * change - without a database.
 */
function fakeDb(results: unknown[]) {
  const writes: { op: string; values: Record<string, unknown> }[] = [];
  const queue = [...results];
  const chain = (op: string | null): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const value = op ? undefined : queue.shift();
          return (resolve: (v: unknown) => void) => resolve(value);
        }
        if (prop === 'values' || prop === 'set') {
          return (values: Record<string, unknown>) => {
            writes.push({ op: op ?? String(prop), values });
            return chain(op);
          };
        }
        if (prop === 'insert' || prop === 'update' || prop === 'delete') return () => chain(String(prop));
        return () => chain(op);
      },
    });
  return { db: chain(null) as Database, writes, queue };
}

const storage = (): jest.Mocked<StorageService> => ({
  upload: jest.fn().mockResolvedValue({ key: 'k' }),
  download: jest.fn().mockResolvedValue(Buffer.from('img')),
  delete: jest.fn().mockResolvedValue(undefined),
  getSignedUrl: jest.fn(),
});

const ROW = {
  caregiverId: 'cg-1',
  slug: 'abcdefgh2345',
  isShared: false,
  firstName: 'Nadeesha',
  headline: 'Home carer',
  bio: 'Ten years caring for older people.',
  photoKey: null as string | null,
  photoMimeType: null as string | null,
  status: 'DRAFT' as string,
  reviewNote: null as string | null,
  reviewedByUserId: null,
  reviewedAt: null,
  consentAcceptedAt: null as Date | null,
  consentVersion: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function profiles(results: unknown[], publicSearch?: Partial<PublicSearchService>, training?: Partial<TrainingService>) {
  const fake = fakeDb(results);
  const files = storage();
  const service = new SharedProfilesService(
    fake.db,
    files,
    (publicSearch ?? {}) as PublicSearchService,
    (training ?? { completedTitles: jest.fn().mockResolvedValue(new Map()), publicCertificates: jest.fn().mockResolvedValue(new Map()) }) as unknown as TrainingService,
    { publicFor: jest.fn().mockResolvedValue(new Map()) } as never,
  );
  return { service, ...fake, files };
}

describe('shared profile helpers', () => {
  it('makes unguessable 12-character links from an unambiguous alphabet', () => {
    const slugs = new Set(Array.from({ length: 200 }, generateSlug));
    expect(slugs.size).toBe(200);
    for (const s of slugs) expect(s).toMatch(/^[a-km-np-z2-9]{12}$/);
  });

  it('starts a shared profile with the first word of the full name only', () => {
    expect(firstNameOf('  Nadeesha Kumari Perera ')).toBe('Nadeesha');
  });

  it('makes enquiry references that read out cleanly', () => {
    expect(generateEnquiryReference()).toMatch(/^IE-[2-9A-HJ-NP-TV-Z]{6}$/);
  });
});

describe('SharedProfilesService', () => {
  it('will not share on consent to wording the caregiver was not shown', async () => {
    const { service } = profiles([]);
    await expect(service.share('cg-1', { consent: true, consentVersion: '2020-01' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records consent and sends a first share to staff for review', async () => {
    const { service, writes } = profiles([[ROW], [ROW], [], []]);
    await service.share('cg-1', { consent: true, consentVersion: SHARED_PROFILE_CONSENT_VERSION });
    const update = writes.find((w) => w.op === 'update')!.values;
    expect(update).toMatchObject({ isShared: true, status: 'PENDING_REVIEW', consentVersion: SHARED_PROFILE_CONSENT_VERSION });
    expect(update.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it('switches an approved profile back on without another review or a new consent date', async () => {
    const approved = { ...ROW, status: 'APPROVED', consentAcceptedAt: new Date('2026-10-01'), consentVersion: SHARED_PROFILE_CONSENT_VERSION };
    const { service, writes } = profiles([[approved], [approved], []]);
    await service.share('cg-1', { consent: true, consentVersion: SHARED_PROFILE_CONSENT_VERSION });
    const update = writes.find((w) => w.op === 'update')!.values;
    expect(update).toEqual(expect.objectContaining({ isShared: true }));
    expect(update).not.toHaveProperty('status');
    expect(update).not.toHaveProperty('consentAcceptedAt');
  });

  it('takes an approved profile offline for review when what it shows changes', async () => {
    const approved = { ...ROW, status: 'APPROVED', isShared: true, consentAcceptedAt: new Date() };
    const { service, writes } = profiles([[approved], [approved], []]);
    await service.updateContent('cg-1', { firstName: 'Nadee', headline: ROW.headline, bio: ROW.bio });
    expect(writes.find((w) => w.op === 'update')!.values).toMatchObject({ firstName: 'Nadee', status: 'PENDING_REVIEW' });
  });

  it('writes nothing when the content did not change', async () => {
    const approved = { ...ROW, status: 'APPROVED' };
    const { service, writes } = profiles([[approved], [approved], []]);
    await service.updateContent('cg-1', { firstName: ROW.firstName, headline: ROW.headline, bio: ROW.bio });
    expect(writes.filter((w) => w.op === 'update')).toHaveLength(0);
  });

  it('withdrawing consent switches sharing off, clears consent and deletes the photo', async () => {
    const live = { ...ROW, status: 'APPROVED', isShared: true, photoKey: 'shared-profiles/cg-1/p.webp', consentAcceptedAt: new Date(), consentVersion: SHARED_PROFILE_CONSENT_VERSION };
    const { service, writes, files } = profiles([[live], [{ ...ROW }], []]);
    await service.withdrawConsent('cg-1');
    expect(files.delete).toHaveBeenCalledWith('shared-profiles/cg-1/p.webp');
    expect(writes.find((w) => w.op === 'update')!.values).toMatchObject({
      isShared: false,
      consentAcceptedAt: null,
      consentVersion: null,
      photoKey: null,
      status: 'DRAFT',
    });
  });

  it('asks staff to say why when they send a profile back', async () => {
    const { service } = profiles([[{ ...ROW, status: 'PENDING_REVIEW', consentAcceptedAt: new Date() }]]);
    await expect(service.review('cg-1', { decision: 'REJECT' }, 'staff-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('shows the public only the allow-listed fields - never a surname, contact details or documents', async () => {
    const live = { ...ROW, status: 'APPROVED', isShared: true, photoKey: 'shared-profiles/cg-1/1234abcd-x.webp', consentAcceptedAt: new Date() };
    const base = {
      publicId: 'pub',
      gender: 'FEMALE',
      approxAge: 42,
      yearsExperience: 10,
      district: 'Gampaha',
      city: 'Negombo',
      districtId: 7,
      cityId: 548,
      preferredLocations: ['Negombo'],
      languages: [{ name: 'English', proficiency: 'FLUENT' }],
      skills: [{ id: 's1', name: 'Dementia care' }],
      availability: {},
      hasVerifiedQualification: true,
      verified: true,
      careTypes: ['LIVE_IN'],
      qualificationSummary: ['Certificate in Caregiving'],
      relevantExperienceSummary: [],
      homeLocation: { latitude: 7.2, longitude: 79.8, precision: 'city' },
      distanceKm: null,
      serviceArea: [],
    };
    const { service } = profiles(
      [[{ p: live, overseas: { caregiverId: 'cg-1', openToOverseas: true, targetCountries: ['JP', 'XX'], passportHeld: true, passportExpiry: '2030-01-01', availableFrom: '2027-01-01' } }]],
      { profilesFor: jest.fn().mockResolvedValue(new Map([['cg-1', base]])) },
      {
        completedTitles: jest.fn().mockResolvedValue(new Map([['cg-1', ['English for caregivers']]])),
        publicCertificates: jest.fn().mockResolvedValue(new Map([['cg-1', [{ number: 'TC-2026-ABC234', verifyCode: 'ABCDEFGHJK23', programmeTitle: 'English for caregivers', issuedOn: '2026-09-01' }]]])),
      },
    );
    const profile = await service.publicProfile('abcdefgh2345', 'en');
    expect(Object.keys(profile).sort()).toEqual(
      [
        'approxAge',
        'assessments',
        'availableFrom',
        'bio',
        'careTypes',
        'certificates',
        'completedTraining',
        'firstName',
        'hasVerifiedQualification',
        'headline',
        'languages',
        'photoUrl',
        'qualifications',
        'skills',
        'slug',
        'targetCountries',
        'verified',
        'yearsExperience',
      ].sort(),
    );
    expect(profile.targetCountries).toEqual(['JP']);
    expect(profile.photoUrl).toBe('/public/talent/abcdefgh2345/photo?v=1234abcd');
    expect(JSON.stringify(profile)).not.toMatch(/Negombo|passport|2030-01-01|pub"/);
    // A certificate on the profile: its number and check code, never the holder's full name.
    expect(Object.keys(profile.certificates[0]).sort()).toEqual(['issuedOn', 'number', 'programmeTitle', 'verifyCode']);
  });
});

describe('EmployerEnquiriesService', () => {
  const email = { sendNotificationEmail: jest.fn().mockResolvedValue(undefined) };
  const emailSettings = { getResolved: jest.fn().mockResolvedValue({ requestAlertsTo: 'team@example.com' }) };
  const config = { get: jest.fn() };
  const dto = {
    organisationName: 'Sakura Care',
    organisationType: 'CARE_HOME' as const,
    country: 'JP' as const,
    contactName: 'Aiko Tanaka',
    email: 'Aiko@Example.jp',
    rolesCount: 3,
    careSettings: ['NURSING_HOME' as const, 'NURSING_HOME' as const],
    visaSponsorship: 'YES' as const,
    consent: true as const,
  };

  function enquiries(liveId: string | null = null) {
    const fake = fakeDb([]);
    const shared = { liveCaregiverIdForSlug: jest.fn().mockResolvedValue(liveId) };
    const notifier = new InternationalNotifier(fake.db, email as never, emailSettings as never, config as never);
    const service = new EmployerEnquiriesService(fake.db, shared as never, notifier);
    return { service, ...fake, shared };
  }

  it('stores nothing for a bot that filled the hidden field, but looks successful', async () => {
    const { service, writes } = enquiries();
    await expect(service.create({ ...dto, website2: 'http://spam' })).resolves.toEqual({ reference: expect.stringMatching(/^IE-/) });
    expect(writes).toHaveLength(0);
  });

  it('saves the enquiry with consent recorded, a lower-cased email and no duplicate care settings', async () => {
    const { service, writes } = enquiries();
    await service.create(dto);
    expect(writes[0].values).toMatchObject({ email: 'aiko@example.jp', careSettings: ['NURSING_HOME'], caregiverId: null, country: 'JP' });
    expect(writes[0].values.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it('attaches the caregiver only while their shared profile is live', async () => {
    const stale = enquiries(null);
    await stale.service.create({ ...dto, talentSlug: 'oldlinkabcde' });
    expect(stale.writes[0].values.caregiverId).toBeNull();

    const live = enquiries('cg-1');
    await live.service.create({ ...dto, talentSlug: 'abcdefgh2345' });
    expect(live.writes[0].values.caregiverId).toBe('cg-1');
  });
});

describe('training', () => {
  const row = {
    id: 'p1',
    category: 'ENGLISH' as const,
    format: 'BLENDED' as const,
    titleEn: 'English for caregivers',
    titleSi: 'සාත්තු සේවකයින් සඳහා ඉංග්‍රීසි',
    titleTa: null,
    descriptionEn: 'Speaking and listening at work.',
    descriptionSi: null,
    descriptionTa: null,
    duration: '8 weeks',
    feeLkr: null,
    nextStartDate: null,
    isActive: true,
    sortOrder: 0,
    passMark: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("shows a programme in the visitor's language, falling back to English", () => {
    expect(localiseProgramme(row, 'si')).toMatchObject({ title: row.titleSi, description: row.descriptionEn });
    expect(localiseProgramme(row, 'ta').title).toBe(row.titleEn);
  });

  it('records completion with today as the date when staff do not give one', async () => {
    const enrolment = { id: 'e1', programmeId: 'p1', caregiverId: 'cg-1', status: 'ENROLLED', completedAt: null, score: null, progressPercent: 40, staffNote: null };
    // the enrolment; (update); certificate: no caregiver row found; then the programme list.
    const fake = fakeDb([[{ e: enrolment, passMark: null }], [], [row], [{ n: 1 }], [{ id: 'e1', createdAt: new Date(), cert: null }]]);
    const service = new TrainingService(fake.db);
    await service.updateEnrolment('e1', { status: 'COMPLETED' });
    expect(fake.writes[0].values).toMatchObject({ status: 'COMPLETED', completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
});

describe('profile photos', () => {
  async function jpegWithGps(size = 900) {
    return sharp({ create: { width: size, height: Math.round(size * 0.75), channels: 3, background: '#8aa' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'PhoneCo', Artist: 'Someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '7/1 12/1 0/1' } })
      .toBuffer();
  }

  it('publishes a square WebP with every metadata block removed', async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await preparePublicPhoto({ mimetype: 'image/jpeg', size: input.length, buffer: input });
    const meta = await sharp(out.buffer).metadata();
    expect(out.mimeType).toBe('image/webp');
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 640, 640]);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('rejects a file that only claims to be an image', async () => {
    const buffer = Buffer.from('%PDF-1.7 not a photo');
    await expect(preparePublicPhoto({ mimetype: 'image/jpeg', size: buffer.length, buffer })).rejects.toThrow('could not be read');
  });

  it('rejects a photo too small to show', async () => {
    const buffer = await jpegWithGps(120);
    await expect(preparePublicPhoto({ mimetype: 'image/jpeg', size: buffer.length, buffer })).rejects.toThrow('too small');
  });
});

describe('international controllers', () => {
  const reflector = new Reflector();

  it.each(['createEnquiry', 'summary', 'trainingProgrammes', 'talent', 'talentProfile', 'talentPhoto'])('%s is @Public()', (handler) => {
    expect(reflector.get(IS_PUBLIC_KEY, (PublicInternationalController.prototype as never)[handler])).toBe(true);
  });

  it('never lets anyone but the caregiver give consent to share', () => {
    const controller = new CaregiverInternationalController({} as never, { share: jest.fn() } as never, {} as never, {} as never, {} as never);
    expect(() => controller.share('cg-1', { consent: true, consentVersion: SHARED_PROFILE_CONSENT_VERSION }, { userId: 'u', email: null, role: 'ADMIN' })).toThrow(
      ForbiddenException,
    );
  });
});
