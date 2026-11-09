import { Global, Module } from '@nestjs/common';
import { PublicSearchModule } from '../public-search/public-search.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ReviewSettingsService } from './review-settings.service';
import { ReviewStore } from './review-store.service';
import { ReviewsService } from './reviews.service';
import { ReviewsNotifier } from './reviews-notifier.service';
import { ReviewRequestSweepService } from './review-request-sweep.service';
import { MyReviewsController, PublicReviewsController, ReviewSettingsController, StaffReviewsController } from './reviews.controller';

/**
 * Rating totals and settings. Global and database-only, so public search
 * (stars on cards, the ranking signal) and bookings (who the client can rate)
 * read them without depending on the reviews module - which itself depends on
 * public search for caregiver profiles.
 */
@Global()
@Module({
  providers: [ReviewSettingsService, ReviewStore],
  exports: [ReviewSettingsService, ReviewStore],
})
export class ReviewsCoreModule {}

/** Clients rating caregivers, public and caregiver views, staff moderation, and rating requests. */
@Module({
  imports: [PublicSearchModule, EmailModule, WhatsappModule],
  controllers: [MyReviewsController, PublicReviewsController, StaffReviewsController, ReviewSettingsController],
  providers: [ReviewsService, ReviewsNotifier, ReviewRequestSweepService],
  // The To do list asks which caregivers a client can rate.
  exports: [ReviewsService],
})
export class ReviewsModule {}
