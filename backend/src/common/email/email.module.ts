import { Global, Module } from '@nestjs/common';
import { ResendEmailService } from './resend-email.service';
import { AccountSecurityService } from '../security/account-security.service';

@Global()
@Module({
  providers: [ResendEmailService, AccountSecurityService],
  exports: [ResendEmailService, AccountSecurityService],
})
export class EmailModule {}
