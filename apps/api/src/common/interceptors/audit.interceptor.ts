import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, AuditMeta } from '../decorators/audit.decorator';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!meta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId?: string } | undefined;

    return next.handle().pipe(
      tap((result) => {
        const entityId = result?.id ?? request.params?.id ?? null;
        // Never store request bodies verbatim - just enough to know what happened.
        void this.auditService.record({
          userId: user?.userId ?? null,
          action: meta.action,
          entityType: meta.entityType,
          entityId,
          ipAddress: request.ip ?? null,
        });
      }),
    );
  }
}
