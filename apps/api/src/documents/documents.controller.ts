import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @CaregiverScope()
  findAll(@Param('caregiverId') caregiverId: string) {
    return this.documentsService.findAllForCaregiver(caregiverId);
  }

  @Post()
  @CaregiverScope()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit({ action: 'UPLOAD_DOCUMENT', entityType: 'CaregiverDocument' })
  upload(
    @Param('caregiverId') caregiverId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.upload(caregiverId, dto.documentType, file, user.userId);
  }

  // Was unscoped before self-registration existed (fine when every login was
  // trusted staff); a caregiver's own NIC/certificate scans are exactly the
  // kind of file that must not be fetchable by guessing another caregiver's
  // document id, so this needs the same ownership check as everything else.
  @Get(':id/file')
  @CaregiverScope()
  async getFile(
    @Param('caregiverId') caregiverId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, mimeType, filename } = await this.documentsService.getFile(caregiverId, id, user.userId, req.ip);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="document-${id}"`,
    });
    return new StreamableFile(buffer);
  }

  @Patch(':id/verification')
  @Roles('ADMIN', 'VERIFIER')
  @Audit({ action: 'VERIFY_DOCUMENT', entityType: 'CaregiverDocument' })
  setVerification(
    @Param('caregiverId') caregiverId: string,
    @Param('id') id: string,
    @Body('status') status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED',
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.setVerificationStatus(caregiverId, id, status, user.userId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_DOCUMENT', entityType: 'CaregiverDocument' })
  remove(@Param('caregiverId') caregiverId: string, @Param('id') id: string) {
    return this.documentsService.remove(caregiverId, id);
  }
}
