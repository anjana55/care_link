import { AdvancePaymentService } from './advance-payment.service';
import { AdvancePaymentController, BookingPaymentHoldController } from './advance-payment.controller';
import { BookingsModule } from '../bookings/bookings.module';
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { BillingSettingsService } from './billing-settings.service';
import { BillingNotifier } from './billing-notifier.service';
import { InvoicesService } from './invoices.service';
import { PayoutsService } from './payouts.service';
import { PayhereService } from './payhere.service';
import { AdjustmentsService } from './adjustments.service';
import { BankAccountsService } from './bank-accounts.service';
import { BillingAgentService } from './billing-agent.service';
import { BankAccountsController, BillingAdjustmentsController, BillingSettingsController, InvoicesController, MyBillingController, PayhereNotifyController, PayoutsController } from './billing.controller';

@Module({
  imports: [EmailModule, WhatsappModule, BookingsModule],
  controllers: [BillingSettingsController, BankAccountsController, InvoicesController, PayoutsController, BillingAdjustmentsController, MyBillingController, PayhereNotifyController, AdvancePaymentController, BookingPaymentHoldController],
  providers: [BillingSettingsService, BillingNotifier, InvoicesService, PayoutsService, PayhereService, AdjustmentsService, BankAccountsService, BillingAgentService, AdvancePaymentService],
  // Booking corrections adjust invoices and pay statements through these;
  // placement fee invoices (international) take the business details and PayHere merchant from the settings.
  exports: [InvoicesService, PayoutsService, AdjustmentsService, BillingSettingsService, BillingAgentService, AdvancePaymentService],
})
export class BillingModule {}
