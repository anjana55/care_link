import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregiverLanguages, languages } from '../database/schema';
import { AssignLanguageDto } from './dto/assign-language.dto';

@Injectable()
export class CaregiverLanguagesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAllForCaregiver(caregiverId: string) {
    return this.db
      .select({
        languageId: caregiverLanguages.languageId,
        name: languages.name,
        proficiency: caregiverLanguages.proficiency,
      })
      .from(caregiverLanguages)
      .innerJoin(languages, eq(caregiverLanguages.languageId, languages.id))
      .where(eq(caregiverLanguages.caregiverId, caregiverId));
  }

  async assign(caregiverId: string, dto: AssignLanguageDto) {
    const [existing] = await this.db
      .select()
      .from(caregiverLanguages)
      .where(and(eq(caregiverLanguages.caregiverId, caregiverId), eq(caregiverLanguages.languageId, dto.languageId)))
      .limit(1);
    if (existing) throw new ConflictException('This language is already assigned to the caregiver');

    await this.db.insert(caregiverLanguages).values({
      caregiverId,
      languageId: dto.languageId,
      proficiency: dto.proficiency ?? 'CONVERSATIONAL',
    });
    return this.findAllForCaregiver(caregiverId);
  }

  async remove(caregiverId: string, languageId: string) {
    await this.db
      .delete(caregiverLanguages)
      .where(and(eq(caregiverLanguages.caregiverId, caregiverId), eq(caregiverLanguages.languageId, languageId)));
    return { success: true };
  }
}
