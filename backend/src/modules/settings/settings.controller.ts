import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireRoles } from '../../common/decorators/roles.decorator';
import { GetTenantContext, GetTenantDb } from '../../common/decorators/tenant-context.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import {
  ChangePasswordDto,
  EmailVerificationDto,
  ChangeEmailDto,
  UpdateCompanySettingsDto,
  UpdateLanguageDto,
  UpdateProfileDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';

@Controller('api/settings')
@UseGuards(TenantAccessGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings.read')
  getSettings(@GetTenantDb() db: any, @GetTenantContext() tenant: any) {
    return this.settings.getSettings(db, tenant);
  }

  @Patch()
  @RequireRoles('COMPANY_OWNER')
  @RequirePermissions('settings.update')
  updateSettings(@GetTenantDb() db: any, @Body() body: UpdateCompanySettingsDto) {
    return this.settings.updateSettings(db, body);
  }

  @Get('profile')
  getProfile(@GetTenantDb() db: any, @CurrentUser('id') userId: string) {
    return this.settings.getProfile(db, userId);
  }

  @Patch('profile')
  updateProfile(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: UpdateProfileDto,
  ) {
    return this.settings.updateProfile(db, userId, body);
  }

  @Patch('password')
  changePassword(
    @GetTenantDb() db: any,
    @CurrentUser() user: any,
    @Body() body: ChangePasswordDto,
  ) {
    this.assertCredentialChange(user);
    return this.settings.changePassword(db, user.id, body);
  }

  @Post('email/verification')
  sendEmailVerification(@CurrentUser() user: any, @Body() body: EmailVerificationDto) {
    this.assertCredentialChange(user);
    return this.settings.sendEmailVerification(user.id, body.email, body.currentPassword);
  }

  @Patch('email')
  changeEmail(@CurrentUser() user: any, @Body() body: ChangeEmailDto) {
    this.assertCredentialChange(user);
    return this.settings.changeEmail(user.id, body.email, body.currentPassword, body.verificationCode);
  }

  private assertCredentialChange(user: any) {
    if (user?.isImpersonating || user?.isSuperAdmin) throw new ForbiddenException('Use your own account to change credentials.');
  }

  @Patch('language')
  updateLanguage(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: UpdateLanguageDto,
  ) {
    return this.settings.updateLanguage(db, userId, body);
  }

  @Get('activity-logs')
  @RequirePermissions('activity_logs.read')
  getActivityLogs(
    @GetTenantDb() db: any,
    @Query() query: PaginationQueryDto,
    @Query('entity') entity?: string,
    @Query('userId') userId?: string,
  ) {
    return this.settings.getActivityLogs(db, { ...query, entity, userId });
  }

  @Delete('activity-logs')
  @RequirePermissions('activity_logs.delete')
  clearActivityLogs(@GetTenantDb() db: any) {
    return this.settings.clearActivityLogs(db);
  }

  @Get('search')
  searchRecords(@GetTenantDb() db: any, @CurrentUser() user: any, @Query('q') query = '') {
    return this.settings.searchRecords(db, query, user);
  }

  @Get('notifications')
  getNotifications(@GetTenantDb() db: any, @CurrentUser() user: any) {
    return this.settings.getNotifications(db, user?.id, user);
  }

  @Post('notifications/read')
  markNotificationsRead(@GetTenantDb() db: any, @CurrentUser() user: any) {
    return this.settings.markNotificationsRead(db, user?.id, user);
  }

  @Post('notifications/:id/read')
  markNotificationRead(@GetTenantDb() db: any, @CurrentUser() user: any, @Param('id') id: string) {
    return this.settings.markNotificationRead(db, id, user?.id, user);
  }

  @Post('notifications/:id/dismiss')
  dismissNotification(@GetTenantDb() db: any, @CurrentUser() user: any, @Param('id') id: string) {
    return this.settings.dismissNotification(db, id, user?.id, user);
  }
}
