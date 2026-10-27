import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuditModule } from '../audit/audit.module';
import { DataTransferController } from './data-transfer.controller';
import { CaregiverTransferService } from './caregiver-transfer.service';
import { ClientTransferService } from './client-transfer.service';

@Module({
  imports: [WhatsappModule, AuditModule],
  providers: [CaregiverTransferService, ClientTransferService],
  controllers: [DataTransferController],
})
export class DataTransferModule {}
