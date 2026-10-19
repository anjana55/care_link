import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { BillingSettingsService } from './billing-settings.service';
import { BillingNotifier } from './billing-notifier.service';
import { InvoicesService } from './invoices.service';
import { PayoutsService } from './payouts.service';
import { PayhereService } from './payhere.service';
import { BillingSettingsController, InvoicesController, MyBillingController, PayhereNotifyController, PayoutsController } from './billing.controller';

@Module({
  imports: [EmailModule, WhatsappModule],
  controllers: [BillingSettingsController, InvoicesController, PayoutsController, MyBillingController, PayhereNotifyController],
  providers: [BillingSettingsService, BillingNotifier, InvoicesService, PayoutsService, PayhereService],
})
export class BillingModule {}
