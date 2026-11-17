import { Module } from '@nestjs/common';
import { CandidatePoolService } from './candidate-pool.service';

/** Who could take a job - shared by the matching agent and cover. Depends on nothing but the database and ratings. */
@Module({
  providers: [CandidatePoolService],
  exports: [CandidatePoolService],
})
export class CandidatePoolModule {}
