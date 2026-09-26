import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { users } from '../database/schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(dto: CreateUserDto) {
    const [existing] = await this.db.select().from(users).where(eq(users.email, dto.email)).limit(1);
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.db.insert(users).values({
      id,
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role,
      // Vouched for by an already-authenticated admin at creation time, so
      // there's no self-service email loop to close for these roles -
      // unlike a self-registered CAREGIVER account, which starts null here.
      emailVerifiedAt: new Date(),
    });

    return this.findOne(id);
  }

  async findAll() {
    const rows = await this.db.select().from(users);
    return rows.map(({ passwordHash, ...rest }) => rest);
  }

  async findOne(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async setActive(id: string, isActive: boolean) {
    await this.findOne(id);
    await this.db.update(users).set({ isActive }).where(eq(users.id, id));
    return this.findOne(id);
  }
}
