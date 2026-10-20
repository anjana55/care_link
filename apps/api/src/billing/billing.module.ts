import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { BillingSettingsService } from './billing-settings.service';
import { BillingNotifier } from './billing-notifier.service';
import { InvoicesService } from './invoices.service';
import { PayoutsService } from './payouts.service';
import { PayhereService } from './payhere.service';
import { AdjustmentsService } from './adjustments.service';
import { BillingAdjustmentsController, BillingSettingsController, InvoicesController, MyBillingController, PayhereNotifyController, PayoutsController } from './billing.controller';

@Module({
  imports: [EmailModule, WhatsappModule],
  controllers: [BillingSettingsController, InvoicesController, PayoutsController, BillingAdjustmentsController, MyBillingController, PayhereNotifyController],
  providers: [BillingSettingsService, BillingNotifier, InvoicesService, PayoutsService, PayhereService, AdjustmentsService],
  // Booking corrections adjust invoices and pay statements through these.
  exports: [InvoicesService, PayoutsService, AdjustmentsService],
})
export class BillingModule {}
