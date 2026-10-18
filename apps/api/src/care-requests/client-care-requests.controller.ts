import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { RequestWithLanguage } from '../common/i18n/language.middleware';
import { CareRequestsService } from './care-requests.service';
import { SavedCaregiversService } from './saved-caregivers.service';
import { CreateCareRequestDto } from './dto/create-care-request.dto';

/**
 * The signed-in client's own requests and shortlist, on the public site.
 *
 * Everything is scoped to the caller's patient record (from the JWT), never to
 * an id in the URL, and caregivers are addressed only by public id. Staff
 * roles get 403 here: their view of the same data is /care-requests.
 */
@ApiTags('client-care')
@ApiBearerAuth()
@Roles('PATIENT_GUARDIAN')
@Controller('me')
export class ClientCareRequestsController {
  constructor(
    private readonly requests: CareRequestsService,
    private readonly saved: SavedCaregiversService,
  ) {}

  @Get('care-requests')
  list(@CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.requests.listForClient(user, req.lang);
  }

  // Tighter than the app-wide default: each one emails staff.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('care-requests')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCareRequestDto, @Req() req: RequestWithLanguage) {
    return this.requests.create(user, dto, req.lang ?? 'en');
  }

  @Post('care-requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.cancelByClient(user, id);
  }

  @Get('saved-caregivers')
  listSaved(@CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.saved.list(user, req.lang);
  }

  @Put('saved-caregivers/:publicId')
  save(@CurrentUser() user: AuthenticatedUser, @Param('publicId', ParseUUIDPipe) publicId: string) {
    return this.saved.save(user, publicId);
  }

  @Delete('saved-caregivers/:publicId')
  unsave(@CurrentUser() user: AuthenticatedUser, @Param('publicId', ParseUUIDPipe) publicId: string) {
    return this.saved.remove(user, publicId);
  }

  @Get('caregiver-relations')
  @ApiQuery({ name: 'publicIds', description: 'Comma-separated caregiver public ids (up to 100)' })
  relations(@CurrentUser() user: AuthenticatedUser, @Query('publicIds') publicIds?: string) {
    const ids = (publicIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    return this.requests.relationsFor(user, ids);
  }
}
