import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../database/schema/users.schema';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
  /** Present only when role === 'CAREGIVER': the caregiver record this login owns. */
  caregiverId?: string;
  /** Present only when role === 'PATIENT_GUARDIAN': the patient record this login owns. */
  patientId?: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
