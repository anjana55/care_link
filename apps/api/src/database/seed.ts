import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq } from 'drizzle-orm';
import * as mysql from 'mysql2/promise';
import { randomUUID as uuid } from 'crypto';
import * as schema from './schema';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection, { schema, mode: 'default' });

  console.log('Seeding skills...');
  const skillNames = [
    ['Insulin Administration', 'Medical'],
    ["Parkinson's Care", 'Specialized Care'],
    ['Patient Meal Preparation', 'Daily Living'],
    ['Vital Signs Monitoring', 'Medical'],
    ['Blood Pressure Monitoring', 'Medical'],
    ['Blood Sugar Monitoring', 'Medical'],
    ['Catheter Care', 'Medical'],
    ['Tube Feeding', 'Medical'],
    ['Adult Diaper Changing', 'Daily Living'],
    ['Wound Care / Dressing', 'Medical'],
    ['Dementia Care', 'Specialized Care'],
    ['Physiotherapy Assistance', 'Specialized Care'],
    ['Medication Assistance', 'Daily Living'],
    ['Bathing Assistance', 'Daily Living'],
  ] as const;
  const skillIds: Record<string, string> = {};
  for (const [name, category] of skillNames) {
    const id = uuid();
    skillIds[name] = id;
    await db.insert(schema.skills).values({ id, name, category }).onDuplicateKeyUpdate({ set: { category } });
  }

  console.log('Seeding languages...');
  const languageDefs = [
    ['Sinhala', 'si'],
    ['Tamil', 'ta'],
    ['English', 'en'],
  ] as const;
  const languageIds: Record<string, string> = {};
  for (const [name, code] of languageDefs) {
    const id = uuid();
    languageIds[name] = id;
    await db.insert(schema.languages).values({ id, name, code }).onDuplicateKeyUpdate({ set: { code } });
  }

  console.log('Seeding Sri Lankan locations...');
  const locationDefs = [
    ['Colombo', 'Colombo', 'Western'],
    ['Colombo', 'Dehiwala', 'Western'],
    ['Gampaha', 'Negombo', 'Western'],
    ['Gampaha', 'Ja-Ela', 'Western'],
    ['Kandy', 'Kandy', 'Central'],
    ['Kandy', 'Peradeniya', 'Central'],
    ['Galle', 'Galle', 'Southern'],
    ['Matara', 'Matara', 'Southern'],
    ['Kurunegala', 'Kurunegala', 'North Western'],
    ['Jaffna', 'Jaffna', 'Northern'],
  ] as const;
  const locationIds: Record<string, string> = {};
  for (const [district, city, province] of locationDefs) {
    const id = uuid();
    locationIds[`${district}-${city}`] = id;
    await db
      .insert(schema.locations)
      .values({ id, district, city, province })
      .onDuplicateKeyUpdate({ set: { province } });
  }

  console.log('Seeding admin + staff users...');
  const adminPasswordHash = await bcrypt.hash('ChangeMe123!', 12);
  const adminId = uuid();
  await db
    .insert(schema.users)
    .values({
      id: adminId,
      email: 'admin@care-platform.local',
      passwordHash: adminPasswordHash,
      fullName: 'Platform Administrator',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { fullName: 'Platform Administrator' } });

  const staffPasswordHash = await bcrypt.hash('ChangeMe123!', 12);
  await db
    .insert(schema.users)
    .values({
      id: uuid(),
      email: 'staff@care-platform.local',
      passwordHash: staffPasswordHash,
      fullName: 'Registration Staff',
      role: 'STAFF',
      emailVerifiedAt: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { fullName: 'Registration Staff' } });

  const verifierPasswordHash = await bcrypt.hash('ChangeMe123!', 12);
  await db
    .insert(schema.users)
    .values({
      id: uuid(),
      email: 'verifier@care-platform.local',
      passwordHash: verifierPasswordHash,
      fullName: 'Document Verifier',
      role: 'VERIFIER',
      emailVerifiedAt: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { fullName: 'Document Verifier' } });

  console.log('Seeding a demo self-registered caregiver account...');
  const selfRegPasswordHash = await bcrypt.hash('ChangeMe123!', 12);
  await db
    .insert(schema.users)
    .values({
      id: uuid(),
      email: 'selfregistered@care-platform.local',
      passwordHash: selfRegPasswordHash,
      fullName: 'Dilani Rathnayake',
      role: 'CAREGIVER',
      emailVerifiedAt: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { fullName: 'Dilani Rathnayake' } });

  // ON DUPLICATE KEY UPDATE keeps the *existing* row's id when this email
  // was already seeded in a prior run - re-select rather than trust the
  // locally generated uuid above, which MySQL may have discarded.
  const [selfRegUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, 'selfregistered@care-platform.local'))
    .limit(1);
  const selfRegUserId = selfRegUser!.id;

  const [existingSelfRegCaregiver] = await db
    .select({ id: schema.caregivers.id })
    .from(schema.caregivers)
    .where(eq(schema.caregivers.userId, selfRegUserId))
    .limit(1);
  if (!existingSelfRegCaregiver) {
    await db.insert(schema.caregivers).values({
      id: uuid(),
      publicId: uuid(),
      userId: selfRegUserId,
      registrationNumber: `CG-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      fullName: 'Dilani Rathnayake',
      permanentAddress: '77 Station Road, Colombo, Sri Lanka',
      dateOfBirth: '1994-04-02' as unknown as Date,
      gender: 'FEMALE',
      civilStatus: 'SINGLE',
      primaryPhone: '0779990000',
      emergencyContactName: 'Nilmini Rathnayake',
      emergencyContactNumber: '0771110000',
      emergencyContactRelationship: 'Mother',
      status: 'DRAFT',
      consentAcceptedAt: new Date(),
    });
  }

  console.log('Seeding fictional caregivers...');
  const fictionalCaregivers = [
    {
      fullName: 'Nimali Perera',
      nic: '198545612345',
      dateOfBirth: '1985-03-14',
      gender: 'FEMALE' as const,
      civilStatus: 'MARRIED' as const,
      phone: '0771234501',
      status: 'ACTIVE' as const,
      skills: ['Insulin Administration', 'Vital Signs Monitoring', 'Wound Care / Dressing'],
      languages: ['Sinhala', 'English'],
      location: 'Colombo-Colombo',
      nightDuty: false,
      hasVerifiedQualification: true,
    },
    {
      fullName: 'Kumaran Selvarajah',
      nic: '199078945612',
      dateOfBirth: '1990-07-22',
      gender: 'MALE' as const,
      civilStatus: 'SINGLE' as const,
      phone: '0771234502',
      status: 'ACTIVE' as const,
      skills: ["Parkinson's Care", 'Physiotherapy Assistance'],
      languages: ['Tamil', 'English'],
      location: 'Jaffna-Jaffna',
      nightDuty: false,
      hasVerifiedQualification: false,
    },
    {
      fullName: 'Samanthi Gunawardena',
      nic: '198712345098',
      dateOfBirth: '1987-06-11',
      gender: 'FEMALE' as const,
      civilStatus: 'MARRIED' as const,
      phone: '0771234506',
      status: 'ACTIVE' as const,
      // Deliberately matches the AI-search example scenario in the brief:
      // female, Colombo, Parkinson's care, night duty, medication + bathing.
      skills: ["Parkinson's Care", 'Medication Assistance', 'Bathing Assistance'],
      languages: ['Sinhala', 'English'],
      location: 'Colombo-Colombo',
      nightDuty: true,
      hasVerifiedQualification: true,
    },
    {
      fullName: 'Chamari Wijesinghe',
      nic: '199234567890',
      dateOfBirth: '1992-11-05',
      gender: 'FEMALE' as const,
      civilStatus: 'SINGLE' as const,
      phone: '0771234503',
      status: 'UNDER_VERIFICATION' as const,
      skills: ['Dementia Care', 'Adult Diaper Changing', 'Patient Meal Preparation'],
      languages: ['Sinhala'],
      location: 'Kandy-Kandy',
      nightDuty: false,
      hasVerifiedQualification: false,
    },
    {
      fullName: 'Ruwan Fernando',
      nic: '198812345678',
      dateOfBirth: '1988-01-30',
      gender: 'MALE' as const,
      civilStatus: 'MARRIED' as const,
      phone: '0771234504',
      status: 'DRAFT' as const,
      skills: ['Blood Pressure Monitoring', 'Tube Feeding'],
      languages: ['Sinhala', 'English'],
      location: 'Gampaha-Negombo',
      nightDuty: false,
      hasVerifiedQualification: false,
    },
    {
      fullName: 'Priya Thevaraja',
      nic: '199556789012',
      dateOfBirth: '1995-09-18',
      gender: 'FEMALE' as const,
      civilStatus: 'SINGLE' as const,
      phone: '0771234505',
      status: 'DOCUMENTS_PENDING' as const,
      skills: ['Catheter Care', 'Blood Sugar Monitoring'],
      languages: ['Tamil', 'Sinhala'],
      location: 'Colombo-Dehiwala',
      nightDuty: false,
      hasVerifiedQualification: false,
    },
  ];

  for (const c of fictionalCaregivers) {
    const [existing] = await db
      .select({ id: schema.caregivers.id })
      .from(schema.caregivers)
      .where(eq(schema.caregivers.primaryPhone, c.phone))
      .limit(1);
    if (existing) continue; // already seeded in a previous run

    const id = uuid();
    const year = new Date().getFullYear();
    const registrationNumber = `CG-${year}-${Math.floor(100000 + Math.random() * 900000)}`;

    await db.insert(schema.caregivers).values({
      id,
      publicId: uuid(),
      registrationNumber,
      fullName: c.fullName,
      permanentAddress: `No. 12, Temple Road, ${c.location.split('-')[1]}, Sri Lanka`,
      nic: c.nic,
      dateOfBirth: c.dateOfBirth as unknown as Date,
      gender: c.gender,
      civilStatus: c.civilStatus,
      heightCm: 160,
      weightKg: 60,
      primaryPhone: c.phone,
      emergencyContactName: 'Emergency Contact',
      emergencyContactNumber: '0771111111',
      emergencyContactRelationship: 'Sibling',
      status: c.status,
    });

    // One qualification per seeded caregiver, verified for those flagged
    // hasVerifiedQualification - drives the public "Verified Qualification"
    // badge and its ranking boost.
    await db.insert(schema.qualifications).values({
      id: uuid(),
      caregiverId: id,
      name: 'National Vocational Qualification in Caregiving',
      type: 'NVQ',
      institution: 'National Apprenticeship & Industrial Training Authority',
      issueDate: '2020-01-15' as unknown as Date,
      verificationStatus: c.hasVerifiedQualification ? 'VERIFIED' : 'PENDING',
    });

    // One relevant-experience row so patientCategory/careType can drive
    // public search's "relevant experience" summary.
    await db.insert(schema.experiences).values({
      id: uuid(),
      caregiverId: id,
      employerOrClient: 'Private client',
      role: 'Live-in Caregiver',
      country: 'Sri Lanka',
      startDate: '2021-01-01' as unknown as Date,
      careType: c.skills.includes("Parkinson's Care") ? "Parkinson's Care" : 'General Elderly Care',
      patientCategory: 'Elderly',
      verificationStatus: c.hasVerifiedQualification ? 'VERIFIED' : 'PENDING',
    });

    for (const skillName of c.skills) {
      await db.insert(schema.caregiverSkills).values({
        caregiverId: id,
        skillId: skillIds[skillName],
        proficiency: 'INTERMEDIATE',
        yearsOfExperience: 3,
      });
    }

    for (const langName of c.languages) {
      await db.insert(schema.caregiverLanguages).values({
        caregiverId: id,
        languageId: languageIds[langName],
        proficiency: 'FLUENT',
      });
    }

    await db.insert(schema.preferredLocations).values({
      caregiverId: id,
      locationId: locationIds[c.location],
    });

    await db.insert(schema.availability).values({
      id: uuid(),
      caregiverId: id,
      dayDuty: !c.nightDuty,
      nightDuty: c.nightDuty,
      liveIn24h: c.status === 'ACTIVE',
      preferredShift: c.nightDuty ? 'NIGHT' : 'DAY',
      expectedDailyRate: '3500.00',
      expectedMonthlyRate: '85000.00',
      expectedLeaveDays: 4,
    });
  }

  console.log('Seed complete.');
  console.log('Admin login: admin@care-platform.local / ChangeMe123!');
  console.log('Staff login: staff@care-platform.local / ChangeMe123!');
  console.log('Verifier login: verifier@care-platform.local / ChangeMe123!');
  console.log('Self-registered caregiver login: selfregistered@care-platform.local / ChangeMe123!');

  await connection.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
