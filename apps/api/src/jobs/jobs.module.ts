import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';

/** The durable job queue. Global: any module can queue work or register a handler. */
@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
