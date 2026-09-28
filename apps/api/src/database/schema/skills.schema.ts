import { mysqlTable, varchar, text, int, datetime, mysqlEnum, index, primaryKey } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const proficiencyLevelEnum = ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
export type ProficiencyLevel = (typeof proficiencyLevelEnum)[number];

export const skills = mysqlTable('skills', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 150 }).notNull().unique(),
  category: varchar('category', { length: 100 }),
  description: text('description'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const caregiverSkills = mysqlTable(
  'caregiver_skills',
  {
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    skillId: varchar('skill_id', { length: 36 }).notNull(),
    proficiency: mysqlEnum('proficiency', proficiencyLevelEnum).notNull().default('BASIC'),
    yearsOfExperience: int('years_of_experience').default(0),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.caregiverId, table.skillId] }),
    skillIdx: index('caregiver_skills_skill_idx').on(table.skillId),
  }),
);
