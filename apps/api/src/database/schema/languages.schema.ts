import { mysqlTable, varchar, datetime, mysqlEnum, index, primaryKey } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const languageProficiencyEnum = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'] as const;
export type LanguageProficiency = (typeof languageProficiencyEnum)[number];

export const languages = mysqlTable('languages', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  code: varchar('code', { length: 10 }).unique(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const caregiverLanguages = mysqlTable(
  'caregiver_languages',
  {
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    languageId: varchar('language_id', { length: 36 }).notNull(),
    proficiency: mysqlEnum('proficiency', languageProficiencyEnum).notNull().default('CONVERSATIONAL'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.caregiverId, table.languageId] }),
    languageIdx: index('caregiver_languages_language_idx').on(table.languageId),
  }),
);
