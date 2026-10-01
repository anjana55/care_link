import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { languages } from '../database/schema';

export interface CreateLanguageInput {
  name: string;
  code?: string;
}

@Injectable()
export class LanguagesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll() {
    return this.db.select().from(languages);
  }

  async create(input: CreateLanguageInput) {
    const [existing] = await this.db.select().from(languages).where(eq(languages.name, input.name)).limit(1);
    if (existing) throw new ConflictException('Language already exists');
    const id = uuid();
    await this.db.insert(languages).values({ id, ...input });
    return { id, ...input };
  }
}
