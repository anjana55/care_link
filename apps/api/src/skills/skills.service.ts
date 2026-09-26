import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { skills } from '../database/schema';

export interface CreateSkillInput {
  name: string;
  category?: string;
  description?: string;
}

@Injectable()
export class SkillsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findAll() {
    return this.db.select().from(skills);
  }

  async create(input: CreateSkillInput) {
    const [existing] = await this.db.select().from(skills).where(eq(skills.name, input.name)).limit(1);
    if (existing) throw new ConflictException('Skill already exists');
    const id = uuid();
    await this.db.insert(skills).values({ id, ...input });
    return { id, ...input };
  }
}
