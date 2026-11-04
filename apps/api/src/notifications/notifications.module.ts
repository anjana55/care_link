import { Global, Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CarePlansModule } from '../care-plans/care-plans.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import { TodosService } from './todos.service';
import { AnnouncementsService } from './announcements.service';
import { ReminderSweepService } from './reminder-sweep.service';
import { AnnouncementsController, MyNotificationsController, NotificationSettingsController } from './notifications.controller';

/**
 * The bell's store and its settings. Global and depending only on the
 * database and push, so every notifier (bookings, billing, requests,
 * reviews, care plans, corrections, documents) can call notify() without
 * importing the modules that build the To do list.
 */
@Global()
@Module({
  providers: [NotificationsService, NotificationSettingsService],
  exports: [NotificationsService, NotificationSettingsService],
})
export class NotificationsCoreModule {}

/** The bell's endpoints, the To do list, reminders, and staff announcements. */
@Module({
  imports: [EmailModule, WhatsappModule, CarePlansModule, ReviewsModule],
  controllers: [MyNotificationsController, AnnouncementsController, NotificationSettingsController],
  providers: [TodosService, AnnouncementsService, ReminderSweepService],
})
export class NotificationsModule {}
