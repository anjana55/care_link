import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestWithLanguage } from '../common/i18n/language.middleware';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { ReviewSettingsService } from './review-settings.service';
import { PublicReviewsQueryDto, ReviewReasonDto, StaffReviewQueryDto, SubmitReviewDto, UpdateReviewSettingsDto } from './dto/review.dto';

/** A caregiver's public id: the same shape the public profile route accepts. */
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,36}$/;
const publicIdOrThrow = (v: string) => (PUBLIC_ID.test(v) ? v : '_');

/** Clients rating their caregivers, and caregivers reading their own ratings. */
@ApiTags('reviews')
@ApiBearerAuth()
@Controller('me')
export class MyReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Caregivers the client can rate now and hasn't yet. */
  @Get('reviews/pending')
  @Roles('PATIENT_GUARDIAN')
  pending(@CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.reviews.pending(user, req.lang);
  }

  @Get('bookings/:bookingId/reviews/:publicId')
  @Roles('PATIENT_GUARDIAN')
  one(@Param('bookingId', ParseUUIDPipe) bookingId: string, @Param('publicId') publicId: string, @CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.reviews.one(user, bookingId, publicIdOrThrow(publicId), req.lang);
  }

  @Put('bookings/:bookingId/reviews/:publicId')
  @Roles('PATIENT_GUARDIAN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'RATE_CAREGIVER', entityType: 'Booking' })
  submit(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Param('publicId') publicId: string,
    @Body() dto: SubmitReviewDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithLanguage,
  ) {
    return this.reviews.submit(user, bookingId, publicIdOrThrow(publicId), dto, req.lang);
  }

  @Delete('bookings/:bookingId/reviews/:publicId')
  @Roles('PATIENT_GUARDIAN')
  @HttpCode(204)
  @Audit({ action: 'DELETE_CAREGIVER_RATING', entityType: 'Booking' })
  async remove(@Param('bookingId', ParseUUIDPipe) bookingId: string, @Param('publicId') publicId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.reviews.remove(user, bookingId, publicIdOrThrow(publicId));
  }

  /** A caregiver's own ratings. */
  @Get('reviews')
  @Roles('CAREGIVER')
  own(@CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.reviews.own(user, req.lang);
  }
}

/** Approved reviews on a caregiver's public profile. */
@ApiTags('reviews')
@Controller('public/caregivers')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':publicId/reviews')
  page(@Param('publicId') publicId: string, @Query() q: PublicReviewsQueryDto) {
    return this.reviews.publicPage(publicIdOrThrow(publicId), q.page ?? 1, q.locale);
  }
}

/** Staff: the moderation queue, and every review of a caregiver or on a booking. */
@ApiTags('reviews')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('reviews')
export class StaffReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() q: StaffReviewQueryDto) {
    return this.reviews.list(q);
  }

  @Get('counts')
  counts() {
    return this.reviews.counts();
  }

  @Get('caregivers/:caregiverId')
  forCaregiver(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.reviews.forCaregiver(caregiverId);
  }

  @Get('bookings/:bookingId')
  forBooking(@Param('bookingId', ParseUUIDPipe) bookingId: string) {
    return this.reviews.forBooking(bookingId);
  }

  @Post(':id/approve-comment')
  @HttpCode(200)
  @Audit({ action: 'APPROVE_REVIEW', entityType: 'CaregiverReview' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.approveComment(id, user);
  }

  @Post(':id/reject-comment')
  @HttpCode(200)
  @Audit({ action: 'REJECT_REVIEW', entityType: 'CaregiverReview' })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.rejectComment(id, dto, user);
  }

  @Post(':id/hide')
  @HttpCode(200)
  @Audit({ action: 'HIDE_REVIEW', entityType: 'CaregiverReview' })
  hide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.hide(id, dto, user);
  }

  @Post(':id/unhide')
  @HttpCode(200)
  @Audit({ action: 'UNHIDE_REVIEW', entityType: 'CaregiverReview' })
  unhide(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.unhide(id);
  }
}

/** Admin-only: Settings > Reviews. */
@ApiTags('settings')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('settings/reviews')
export class ReviewSettingsController {
  constructor(private readonly settings: ReviewSettingsService) {}

  @Get()
  get() {
    return this.settings.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_REVIEW_SETTINGS', entityType: 'ReviewSettings' })
  update(@Body() dto: UpdateReviewSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user.userId);
  }
}
