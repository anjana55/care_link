import { Module } from '@nestjs/common';
import { PublicSearchController } from './public-search.controller';
import { PublicSearchService } from './public-search.service';
import { RankingService } from './ranking/ranking.service';
import { SkillsModule } from '../skills/skills.module';
import { LanguagesModule } from '../languages/languages.module';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [SkillsModule, LanguagesModule, LocationsModule],
  controllers: [PublicSearchController],
  providers: [PublicSearchService, RankingService],
  exports: [PublicSearchService, RankingService],
})
export class PublicSearchModule {}
