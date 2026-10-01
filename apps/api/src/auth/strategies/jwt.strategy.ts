import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import { users } from '../../database/schema';
import type { UserRole } from '../../database/schema/users.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  caregiverId?: string;
  patientId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtPayload) {
    // A signed token alone isn't enough: re-check the account on every request
    // so deactivating/deleting a user or changing their role (Users admin
    // page) takes effect immediately instead of when their access token
    // expires. Role comes from the database, not the token.
    const [user] = await this.db
      .select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is disabled or no longer exists');
    }
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      caregiverId: payload.caregiverId,
      patientId: payload.patientId,
    };
  }
}
