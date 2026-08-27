import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { RequireRoles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AutoRenewDto,
  ConfigureCompanySubscriptionDto,
  CreateCompanyDto,
  InvoicePaymentDto,
  SubscriptionNotesDto,
  UpdateCompanyDto,
} from './superadmin.dto';

@Controller('api/superadmin')
@RequireRoles('SUPER_ADMIN')
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get('account')
  getAccount(@CurrentUser('id') adminId: string) {
    return this.superAdminService.getAccount(adminId);
  }

  @Patch('account/email')
  updateAccountEmail(
    @CurrentUser('id') adminId: string,
    @Body() body: { email: string; currentPassword: string; verificationCode: string },
  ) {
    return this.superAdminService.updateAccountEmail(adminId, body.email, body.currentPassword, body.verificationCode);
  }

  @Post('account/email-verification/send')
  sendAccountEmailVerification(
    @CurrentUser('id') adminId: string,
    @Body() body: { email: string; currentPassword: string },
  ) {
    return this.superAdminService.sendAccountEmailVerification(adminId, body.email, body.currentPassword);
  }

  @Patch('account/password')
  updateAccountPassword(
    @CurrentUser('id') adminId: string,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.superAdminService.updateAccountPassword(adminId, body.currentPassword, body.newPassword);
  }

  @Get('companies')
  async getAllCompanies(@Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.superAdminService.getAllCompanies({ search, status, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Post('companies')
  @HttpCode(HttpStatus.ACCEPTED)
  async createCompany(@Body() body: CreateCompanyDto, @CurrentUser('id') adminId: string) {
    return this.superAdminService.createCompany(body, adminId);
  }

  @Get('companies/email-availability')
  checkCompanyEmailAvailability(@Query('email') email: string) {
    return this.superAdminService.checkCompanyEmailAvailability(email);
  }

  @Post('companies/email-verification/send')
  sendCompanyOnboardingVerification(@Body() body: { email: string }) {
    return this.superAdminService.sendCompanyOnboardingVerification(body.email);
  }

  @Post('companies/email-verification/verify')
  verifyCompanyOnboardingEmail(@Body() body: { email: string; code: string }) {
    return this.superAdminService.verifyCompanyOnboardingEmail(body.email, body.code);
  }

  @Get('neon/status')
  getNeonStatus() {
    return this.superAdminService.getNeonStatus();
  }

  @Get('companies/:id')
  async getCompanyById(@Param('id') id: string) {
    return this.superAdminService.getCompanyById(id);
  }

  @Patch('companies/:id')
  async updateCompany(@Param('id') id: string, @Body() body: UpdateCompanyDto) {
    return this.superAdminService.updateCompany(id, body);
  }

  @Delete('companies/:id')
  @HttpCode(HttpStatus.OK)
  async deleteCompany(@Param('id') id: string) {
    return this.superAdminService.deleteCompany(id);
  }

  @Patch('companies/:id/status')
  async updateCompanyStatus(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_SETUP' },
  ) {
    return this.superAdminService.updateCompanyStatus(id, body.status);
  }

  @Patch('companies/:id/modules')
  async updateCompanyModules(
    @Param('id') id: string,
    @Body()
    body: {
      constructionEnabled?: boolean;
      realEstateEnabled?: boolean;
      materialManagementEnabled?: boolean;
    },
  ) {
    return this.superAdminService.updateCompanyModules(id, body);
  }

  @Post('companies/:id/rbac/sync')
  @HttpCode(HttpStatus.OK)
  async syncCompanyRbac(@Param('id') id: string) {
    return this.superAdminService.syncCompanyRbac(id);
  }

  @Post('companies/:id/owner/temporary-password')
  @HttpCode(HttpStatus.OK)
  generateCompanyOwnerTemporaryPassword(@Param('id') id: string) {
    return this.superAdminService.generateCompanyOwnerTemporaryPassword(id);
  }

  @Get('onboarding/:id')
  getOnboarding(@Param('id') id: string) { return this.superAdminService.getOnboarding(id); }

  @Post('onboarding/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retryOnboarding(@Param('id') id: string) { return this.superAdminService.retryOnboarding(id); }

  @Post('companies/:id/impersonation')
  @HttpCode(HttpStatus.OK)
  createCompanyImpersonation(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.superAdminService.createCompanyImpersonation(id, adminId);
  }

  @Get('companies/:id/enterprise-configuration')
  getCompanyEnterpriseConfiguration(@Param('id') id: string) {
    return this.superAdminService.getCompanyEnterpriseConfiguration(id);
  }

  @Patch('companies/:id/enterprise-configuration')
  updateCompanyEnterpriseConfiguration(
    @Param('id') id: string,
    @Body() body: {
      workspaceControls: Record<string, boolean>;
      sidebarVisibility: Record<string, boolean>;
      reportVisibility: Record<string, boolean>;
      analyticsVisibility: Record<string, boolean>;
    },
  ) {
    return this.superAdminService.updateCompanyEnterpriseConfiguration(id, body);
  }

  // -----------------------------------------------------------
  // Subscriptions & Invoicing
  // -----------------------------------------------------------

  @Post('invoices/:id/pay')
  @HttpCode(HttpStatus.OK)
  async markInvoicePaid(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: InvoicePaymentDto,
  ) {
    return this.superAdminService.markInvoicePaid(id, body.paymentMethod, adminId);
  }

  @Patch('invoices/:id/extend')
  async extendInvoiceDueDate(
    @Param('id') id: string,
    @Body() body: { extendDays?: number; newDueDate?: string },
  ) {
    return this.superAdminService.extendInvoiceDueDate(id, body.extendDays, body.newDueDate);
  }


  @Post('companies/:id/subscription/renew')
  @HttpCode(HttpStatus.OK)
  createRenewalInvoice(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.superAdminService.createRenewalInvoice(id, adminId);
  }

  @Patch('companies/:id/subscription')
  configureCompanySubscription(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: ConfigureCompanySubscriptionDto,
  ) {
    return this.superAdminService.configureCompanySubscription(id, body, adminId);
  }

  @Post('companies/:id/subscription/suspend')
  @HttpCode(HttpStatus.OK)
  suspendSubscription(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: SubscriptionNotesDto,
  ) {
    return this.superAdminService.suspendSubscription(id, adminId, body.notes);
  }

  @Post('companies/:id/subscription/resume')
  @HttpCode(HttpStatus.OK)
  resumeSubscription(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: SubscriptionNotesDto,
  ) {
    return this.superAdminService.resumeSubscription(id, adminId, body.notes);
  }

  @Post('companies/:id/subscription/cancel')
  @HttpCode(HttpStatus.OK)
  cancelSubscription(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: SubscriptionNotesDto,
  ) {
    return this.superAdminService.cancelSubscription(id, adminId, body.notes);
  }

  @Patch('companies/:id/subscription/auto-renew')
  setSubscriptionAutoRenew(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: AutoRenewDto,
  ) {
    return this.superAdminService.setSubscriptionAutoRenew(id, body.autoRenew, adminId);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelInvoice(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: SubscriptionNotesDto,
  ) {
    return this.superAdminService.cancelInvoice(id, adminId, body.notes);
  }

  // -----------------------------------------------------------
  // Financial Overview
  // -----------------------------------------------------------

  @Get('metrics')
  async getPlatformMetrics() {
    return this.superAdminService.getPlatformFinancialSummary();
  }

  @Get('notifications')
  async getPlatformNotifications() {
    return this.superAdminService.getPlatformNotifications();
  }

  @Post('sync-schemas')
  @HttpCode(HttpStatus.OK)
  async syncTenantSchemas() {
    return this.superAdminService.syncTenantSchemas();
  }
}
