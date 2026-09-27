import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { users, refreshTokens, emailVerificationTokens } from '../database/schema';
import { CreateUserDto, STAFF_MANAGEABLE_ROLES } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

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

  // Scoped to ADMIN/STAFF/VERIFIER logins - this module is for managing
  // staff and admin accounts, not the CAREGIVER/PATIENT_GUARDIAN logins
  // that live behind their own self-registration and profile flows.
  async findAll() {
    const rows = await this.db.select().from(users).where(inArray(users.role, STAFF_MANAGEABLE_ROLES));
    return rows.map(({ passwordHash, ...rest }) => rest);
  }

  async findOne(id: string) {
    const user = await this.findManageableOrThrow(id);
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async update(id: string, dto: UpdateUserDto, currentUserId: string) {
    const target = await this.findManageableOrThrow(id);

    if (dto.email && dto.email !== target.email) {
      const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, dto.email)).limit(1);
      if (existing) {
        throw new ConflictException('A user with this email already exists');
      }
    }

    if (dto.role && dto.role !== target.role && target.role === 'ADMIN') {
      if (id === currentUserId) {
        throw new ForbiddenException('You cannot change your own admin role');
      }
      await this.assertNotLastActiveAdmin(target, 'change the role of');
    }

    await this.db
      .update(users)
      .set({
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.fullName ? { fullName: dto.fullName } : {}),
        ...(dto.role ? { role: dto.role } : {}),
      })
      .where(eq(users.id, id));

    return this.findOne(id);
  }

  async setActive(id: string, isActive: boolean, currentUserId: string) {
    const target = await this.findManageableOrThrow(id);

    if (!isActive) {
      if (id === currentUserId) {
        throw new ForbiddenException('You cannot deactivate your own account');
      }
      if (target.role === 'ADMIN') {
        await this.assertNotLastActiveAdmin(target, 'deactivate');
      }
    }

    await this.db.update(users).set({ isActive }).where(eq(users.id, id));
    return this.findOne(id);
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    await this.findManageableOrThrow(id);
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, id));
    // Force re-authentication with the new password everywhere this
    // account is currently signed in.
    await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, id));
    return { success: true };
  }

  async remove(id: string, currentUserId: string) {
    const target = await this.findManageableOrThrow(id);

    if (id === currentUserId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    if (target.role === 'ADMIN') {
      await this.assertNotLastActiveAdmin(target, 'delete');
    }

    // No FK cascade at the DB level - clean up dependent rows so we don't
    // leave orphaned tokens behind. Audit log rows deliberately keep their
    // userId as a historical record, even though the user is now gone.
    await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, id));
    await this.db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, id));
    await this.db.delete(users).where(eq(users.id, id));
    return { success: true };
  }

  private async findManageableOrThrow(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    // Treat a CAREGIVER/PATIENT_GUARDIAN login as not found here - this
    // module has no business touching those accounts.
    if (!user || !STAFF_MANAGEABLE_ROLES.includes(user.role as (typeof STAFF_MANAGEABLE_ROLES)[number])) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private async assertNotLastActiveAdmin(target: { id: string; isActive: boolean }, action: string) {
    if (!target.isActive) return; // already inactive - doesn't reduce active admin coverage
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), ne(users.id, target.id)));
    if (value === 0) {
      throw new BadRequestException(`Cannot ${action} the last remaining active admin`);
    }
  }
}
