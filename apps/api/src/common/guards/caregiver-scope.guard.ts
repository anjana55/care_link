import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CAREGIVER_SCOPE_KEY } from '../decorators/caregiver-scope.decorator';
import type { UserRole } from '../../database/schema/users.schema';

interface CaregiverScopeMeta {
  staffRoles: UserRole[];
}

@Injectable()
export class CaregiverScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<CaregiverScopeMeta>(CAREGIVER_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @CaregiverScope() on this route - not our concern, defer to
    // whatever @Roles()/RolesGuard already decided.
    if (!meta) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: UserRole; caregiverId?: string } | undefined;

    if (!user) return false;
    if (meta.staffRoles.includes(user.role as UserRole)) return true;

    if (user.role === 'CAREGIVER') {
      const recordId = request.params?.caregiverId ?? request.params?.id;
      if (user.caregiverId && recordId && user.caregiverId === recordId) {
        return true;
      }
      throw new ForbiddenException('You can only access your own caregiver record');
    }

    throw new ForbiddenException('You do not have permission to perform this action');
  }
}
