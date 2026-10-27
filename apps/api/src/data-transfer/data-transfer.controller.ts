import { BadRequestException, Body, Controller, Get, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { CaregiverTransferService } from './caregiver-transfer.service';
import { ClientTransferService } from './client-transfer.service';
import { CaregiverExportDto, ClientExportDto, ImportOptionsDto } from './dto/transfer.dto';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ImportReport } from './import-types';

/** Reads an uploaded spreadsheet export as text: UTF-8 (with or without BOM), UTF-16 or, failing that, Windows-1252. */
export function decodeUpload(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  const text = buffer.toString('utf8');
  return text.includes('�') ? buffer.toString('latin1') : text;
}

/**
 * Spreadsheet import and export of caregivers and clients.
 *
 * Admin only: an export holds every NIC, phone number and address on the
 * platform, and an import creates records in bulk. Every export and every
 * import that changes something is in the audit log, with its filters and
 * counts (never the data itself).
 */
@ApiTags('data-transfer')
@ApiBearerAuth()
@Controller('data-transfer')
@Roles('ADMIN')
export class DataTransferController {
  constructor(
    private readonly caregiverTransfer: CaregiverTransferService,
    private readonly clientTransfer: ClientTransferService,
    private readonly audit: AuditService,
  ) {}

  @Get('caregivers/template')
  caregiverTemplate(@Res({ passthrough: true }) res: Response) {
    return this.csvFile(res, this.caregiverTransfer.template(), 'caregivers-template.csv');
  }

  @Get('clients/template')
  clientTemplate(@Res({ passthrough: true }) res: Response) {
    return this.csvFile(res, this.clientTransfer.template(), 'clients-template.csv');
  }

  @Get('caregivers/export')
  async exportCaregivers(@Query() filter: CaregiverExportDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { csv, count } = await this.caregiverTransfer.export(filter);
    await this.audit.record({ userId: user.userId, action: 'EXPORT_CAREGIVERS', entityType: 'Caregiver', metadata: { count, filter: { ...filter } }, ipAddress: req.ip ?? null });
    return this.csvFile(res, csv, `caregivers-${this.today()}.csv`);
  }

  @Get('clients/export')
  async exportClients(@Query() filter: ClientExportDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { csv, count } = await this.clientTransfer.export(filter);
    await this.audit.record({ userId: user.userId, action: 'EXPORT_CLIENTS', entityType: 'Patient', metadata: { count, filter: { ...filter } }, ipAddress: req.ip ?? null });
    return this.csvFile(res, csv, `clients-${this.today()}.csv`);
  }

  @Post('caregivers/import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES + 1024 } }))
  async importCaregivers(@UploadedFile() file: Express.Multer.File, @Body() options: ImportOptionsDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const report = await this.caregiverTransfer.import(this.readFile(file), options.dryRun !== false);
    await this.recordImport(report, 'IMPORT_CAREGIVERS', 'Caregiver', user, req, file);
    return this.checkReport(report);
  }

  @Post('clients/import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES + 1024 } }))
  async importClients(@UploadedFile() file: Express.Multer.File, @Body() options: ImportOptionsDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const report = await this.clientTransfer.import(this.readFile(file), options.dryRun !== false);
    await this.recordImport(report, 'IMPORT_CLIENTS', 'Patient', user, req, file);
    return this.checkReport(report);
  }

  private readFile(file: Express.Multer.File | undefined): string {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a CSV file to import.');
    if (file.size > MAX_IMPORT_BYTES) throw new BadRequestException('The file is too large. Import at most 2 MB at a time.');
    if (!/\.(csv|txt)$/i.test(file.originalname ?? '') && !/csv|text\/plain/.test(file.mimetype ?? '')) {
      throw new BadRequestException('Save the spreadsheet as CSV (UTF-8) and upload that file.');
    }
    return decodeUpload(file.buffer);
  }

  /** A file the importer can't use at all is a 400, so the page shows it as an error rather than an empty report. */
  private checkReport(report: ImportReport): ImportReport {
    if (report.missingColumns.length) throw new BadRequestException(`The file is missing required columns: ${report.missingColumns.join(', ')}. Start from the template.`);
    if (report.total === 0) throw new BadRequestException('The file has no rows to import.');
    if (report.total > MAX_IMPORT_ROWS) throw new BadRequestException(`Import at most ${MAX_IMPORT_ROWS} rows at a time; this file has ${report.total}.`);
    return report;
  }

  private async recordImport(report: ImportReport, action: string, entityType: string, user: AuthenticatedUser, req: Request, file: Express.Multer.File) {
    if (report.dryRun || report.created === 0) return;
    await this.audit.record({
      userId: user.userId,
      action,
      entityType,
      metadata: { file: file.originalname, rows: report.total, created: report.created, duplicates: report.duplicates, errors: report.errors, ids: report.rows.filter((r) => r.id).map((r) => r.id) },
      ipAddress: req.ip ?? null,
    });
  }

  private csvFile(res: Response, csv: string, filename: string) {
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  private today() {
    return new Date().toISOString().slice(0, 10);
  }
}
