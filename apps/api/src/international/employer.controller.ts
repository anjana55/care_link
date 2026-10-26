import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EmployersService, employerIdOf } from './employers.service';
import { CandidatesService } from './candidates.service';
import { EmployerEnquiriesService } from './employer-enquiries.service';
import { EmployerAccountEnquiryDto, EmployerCandidateActionDto, InterviewRequestDto, UpdateEmployerAccountDto } from './dto/international.dto';

/**
 * An overseas employer's own account. Every route is EMPLOYER-only and works
 * on the employer the login owns (from the session, never from the URL), so
 * there is no address one employer could edit to reach another's data.
 */
@ApiTags('international (employer)')
@ApiBearerAuth()
@Roles('EMPLOYER')
@Controller('employer')
export class EmployerController {
  constructor(
    private readonly employers: EmployersService,
    private readonly candidates: CandidatesService,
    private readonly enquiries: EmployerEnquiriesService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.employers.me(employerIdOf(user));
  }

  @Patch('me')
  @Audit({ action: 'UPDATE_EMPLOYER_ACCOUNT', entityType: 'Employer' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateEmployerAccountDto) {
    return this.employers.updateMe(employerIdOf(user), dto);
  }

  @Get('enquiries')
  ownEnquiries(@CurrentUser() user: AuthenticatedUser, @Query('locale') locale?: string) {
    return this.candidates.ownEnquiries(employerIdOf(user), locale);
  }

  @Post('enquiries')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  createEnquiry(@CurrentUser() user: AuthenticatedUser, @Body() dto: EmployerAccountEnquiryDto) {
    return this.enquiries.createForEmployer(employerIdOf(user), dto);
  }

  @Post('candidates')
  @Audit({ action: 'REQUEST_INTERVIEW', entityType: 'EnquiryCandidate' })
  requestInterview(@CurrentUser() user: AuthenticatedUser, @Body() dto: InterviewRequestDto, @Query('locale') locale?: string) {
    return this.candidates.requestInterview(employerIdOf(user), dto, locale);
  }

  @Patch('candidates/:id')
  @Audit({ action: 'EMPLOYER_CANDIDATE_ACTION', entityType: 'EnquiryCandidate' })
  act(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmployerCandidateActionDto,
    @Query('locale') locale?: string,
  ) {
    return this.candidates.employerAction(employerIdOf(user), id, dto, locale);
  }

  @Get('shortlist')
  shortlist(@CurrentUser() user: AuthenticatedUser, @Query('locale') locale?: string) {
    return this.employers.shortlist(employerIdOf(user), locale);
  }

  @Put('shortlist/:slug')
  addToShortlist(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.employers.addToShortlist(employerIdOf(user), slug, locale);
  }

  @Delete('shortlist/:slug')
  removeFromShortlist(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.employers.removeFromShortlist(employerIdOf(user), slug, locale);
  }
}
