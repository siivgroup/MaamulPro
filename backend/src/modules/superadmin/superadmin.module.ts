import { Module } from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminController } from './superadmin.controller';
import { CompanyOnboardingService } from './company-onboarding.service';

@Module({
  controllers: [SuperAdminController],
  providers: [SuperAdminService, CompanyOnboardingService],
  exports: [SuperAdminService],
})
export class SuperAdminModule {}
