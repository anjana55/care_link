import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { careTypeValues, type CarePlanTemplateSummary, type CarePlanTemplateView, type CareType } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { carePlanTemplateActivities, carePlanTemplates } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { cleanActivities, fieldsToColumns, rowToView, type ActivityRow } from './activity-rows';
import type { CarePlanTemplateDto } from './dto/care-plan.dto';

type Template = typeof carePlanTemplates.$inferSelect;

const careTypesOf = (csv: string): CareType[] => csv.split(',').filter((v): v is CareType => (careTypeValues as readonly string[]).includes(v));

/**
 * The staff library of care plan templates. Applying one to a booking copies
 * its activities (CarePlansService), so nothing here ever changes a plan that
 * already exists - editing, archiving or duplicating a template is safe.
 */
@Injectable()
export class CarePlanTemplatesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(status: 'ACTIVE' | 'ARCHIVED' | 'ALL' = 'ACTIVE'): Promise<CarePlanTemplateSummary[]> {
    const rows = await this.db
      .select()
      .from(carePlanTemplates)
      .where(status === 'ALL' ? undefined : eq(carePlanTemplates.status, status))
      .orderBy(asc(carePlanTemplates.name));
    if (!rows.length) return [];
    const acts = await this.db
      .select({ templateId: carePlanTemplateActivities.templateId, isCritical: carePlanTemplateActivities.isCritical })
      .from(carePlanTemplateActivities)
      .where(inArray(carePlanTemplateActivities.templateId, rows.map((r) => r.id)));
    return rows.map((r) => this.summary(r, acts.filter((a) => a.templateId === r.id)));
  }

  private summary(r: Template, acts: { isCritical: boolean }[]): CarePlanTemplateSummary {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      careTypes: careTypesOf(r.careTypes),
      status: r.status,
      activityCount: acts.length,
      criticalCount: acts.filter((a) => a.isCritical).length,
      updatedAt: new Date(r.updatedAt).toISOString(),
    };
  }

  async get(id: string): Promise<CarePlanTemplateView> {
    const [row] = await this.db.select().from(carePlanTemplates).where(eq(carePlanTemplates.id, id)).limit(1);
    if (!row) throw new NotFoundException('Care plan template not found');
    const acts = (await this.db
      .select()
      .from(carePlanTemplateActivities)
      .where(eq(carePlanTemplateActivities.templateId, id))
      .orderBy(asc(carePlanTemplateActivities.sortOrder))) as ActivityRow[];
    return { ...this.summary(row, acts), activities: acts.map(rowToView) };
  }

  async create(dto: CarePlanTemplateDto, actor: AuthenticatedUser): Promise<CarePlanTemplateView> {
    const activities = cleanActivities(dto.activities);
    const id = uuid();
    await this.db.transaction(async (tx) => {
      await tx.insert(carePlanTemplates).values({
        id,
        name: dto.name,
        description: dto.description ?? null,
        careTypes: dto.careTypes.join(','),
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      });
      if (activities.length) {
        await tx.insert(carePlanTemplateActivities).values(activities.map((a, i) => ({ id: uuid(), templateId: id, sortOrder: i, ...fieldsToColumns(a) })));
      }
    });
    return this.get(id);
  }

  /** Name, description, care types and the whole activity list, replaced together. */
  async update(id: string, dto: CarePlanTemplateDto, actor: AuthenticatedUser): Promise<CarePlanTemplateView> {
    await this.get(id);
    const activities = cleanActivities(dto.activities);
    await this.db.transaction(async (tx) => {
      await tx
        .update(carePlanTemplates)
        .set({ name: dto.name, description: dto.description ?? null, careTypes: dto.careTypes.join(','), updatedByUserId: actor.userId, updatedAt: new Date() })
        .where(eq(carePlanTemplates.id, id));
      await tx.delete(carePlanTemplateActivities).where(eq(carePlanTemplateActivities.templateId, id));
      if (activities.length) {
        await tx.insert(carePlanTemplateActivities).values(activities.map((a, i) => ({ id: uuid(), templateId: id, sortOrder: i, ...fieldsToColumns(a) })));
      }
    });
    return this.get(id);
  }

  async duplicate(id: string, actor: AuthenticatedUser): Promise<CarePlanTemplateView> {
    const t = await this.get(id);
    return this.create(
      { name: `${t.name} (copy)`.slice(0, 150), description: t.description, careTypes: t.careTypes, activities: t.activities.map(({ id: _id, sortOrder: _s, ...a }) => a) },
      actor,
    );
  }

  async setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actor: AuthenticatedUser): Promise<CarePlanTemplateView> {
    const t = await this.get(id);
    if (t.status === status) return t;
    await this.db.update(carePlanTemplates).set({ status, updatedByUserId: actor.userId, updatedAt: new Date() }).where(eq(carePlanTemplates.id, id));
    return this.get(id);
  }

  /** Save a booking's plan as a new template (CarePlansService builds the activities). */
  async createFrom(name: string, careTypes: CareType[], activities: CarePlanTemplateDto['activities'], actor: AuthenticatedUser) {
    if (!activities.length) throw new BadRequestException('The plan has no activities to save');
    return this.create({ name, description: null, careTypes, activities }, actor);
  }
}
