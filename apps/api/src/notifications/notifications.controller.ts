import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { NotificationsSummary } from '@care-platform/shared';
import type { RequestWithLanguage } from '../common/i18n/language.middleware';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import { TodosService } from './todos.service';
import { AnnouncementsService } from './announcements.service';
import { MarkReadDto, NotificationsQueryDto, SaveAnnouncementDto, UpdateNotificationSettingsDto } from './dto/notifications.dto';

/** The bell, for clients and caregivers. */
@ApiTags('notifications')
@ApiBearerAuth()
@Roles('PATIENT_GUARDIAN', 'CAREGIVER')
@Controller('me/notifications')
export class MyNotificationsController {
  constructor(
    private readonly notices: NotificationsService,
    private readonly todos: TodosService,
  ) {}

  /** The bell's number and the To do list, in one call. Polled, so cheap. */
  @Get('summary')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<NotificationsSummary> {
    const [unread, todos] = await Promise.all([this.notices.unreadCount(user.userId), this.todos.forUser(user)]);
    return { unread, todos, badge: unread + todos.length };
  }

  @Get()
  page(@CurrentUser() user: AuthenticatedUser, @Query() q: NotificationsQueryDto, @Req() req: RequestWithLanguage) {
    return this.notices.page(user.userId, req.lang, q.before);
  }

  @Post('read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto) {
    return { marked: await this.notices.markRead(user.userId, dto) };
  }
}

/** Staff: messages to every client, every caregiver, or both. */
@ApiTags('announcements')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list() {
    return this.announcements.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.get(id);
  }

  @Post()
  @Audit({ action: 'CREATE_ANNOUNCEMENT', entityType: 'Announcement' })
  create(@Body() dto: SaveAnnouncementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.announcements.create(dto, user.userId);
  }

  @Patch(':id')
  @Audit({ action: 'UPDATE_ANNOUNCEMENT', entityType: 'Announcement' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAnnouncementDto) {
    return this.announcements.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Audit({ action: 'PUBLISH_ANNOUNCEMENT', entityType: 'Announcement' })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.publish(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Audit({ action: 'DELETE_ANNOUNCEMENT', entityType: 'Announcement' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.announcements.remove(id);
  }
}

/** Admin-only: Settings > Notifications. */
@ApiTags('settings')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('settings/notifications')
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get()
  get() {
    return this.settings.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_NOTIFICATION_SETTINGS', entityType: 'NotificationSettings' })
  update(@Body() dto: UpdateNotificationSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user.userId);
  }
}
