import { Controller, Get, Post, Body, Req, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isPlatformHost, resolveTenantSubdomain } from '../../common/security/platform-host';

// The frontend may be served from a different origin than the API (VITE_API_URL), so the
// browser's actual domain only shows up in Origin/Referer — the request's own Host is the API's.
function requestDomain(req: Request): string | undefined {
  return req.headers.origin || req.headers.referer || req.headers.host;
}

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post(['auth/login', 'sign-in'])
  @Public()
  @HttpCode(HttpStatus.OK)
  async loginCompanyUser(
    @Req() req: Request,
    @Body() body: { email?: string; userName?: string; password?: string; tenantId?: string },
  ) {
    if (process.env.NODE_ENV === 'production' && isPlatformHost(requestDomain(req))) {
      throw new ForbiddenException('Tenant sign-in is not available on this domain');
    }
    const userEmail = body.email || body.userName || '';
    const userPassword = body.password || '';
    const requestSubdomain = resolveTenantSubdomain(requestDomain(req));
    return this.authService.loginCompanyUser(userEmail, userPassword, body.tenantId, requestSubdomain);
  }

  @Post(['auth/superadmin/login', 'superadmin/login'])
  @Public()
  @HttpCode(HttpStatus.OK)
  async loginSuperAdmin(
    @Req() req: Request,
    @Body() body: { email?: string; userName?: string; password?: string },
  ) {
    if (process.env.NODE_ENV === 'production' && !isPlatformHost(requestDomain(req))) {
      throw new ForbiddenException('Super admin sign-in is only available on the platform domain');
    }
    const userEmail = body.email || body.userName || '';
    const userPassword = body.password || '';
    return this.authService.loginSuperAdmin(userEmail, userPassword);
  }

  @Post('auth/impersonation/exchange')
  @Public()
  @HttpCode(HttpStatus.OK)
  exchangeImpersonation(@Body() body: { token?: string }) {
    return this.authService.exchangeImpersonation(body.token || '');
  }

  @Post('auth/password/forgot')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() body: { email?: string }) {
    return this.authService.requestPasswordReset(body.email || '');
  }

  @Post('auth/password/reset')
  @Public()
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: { email?: string; code?: string; newPassword?: string }) {
    return this.authService.resetPassword(
      body.email || '',
      body.code || '',
      body.newPassword || '',
    );
  }

  @Get('auth/session')
  currentSession(@CurrentUser() user: any) {
    return this.authService.currentSession(user);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: any) {
    return this.authService.logout(user);
  }
}
