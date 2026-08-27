import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CentralPrismaService } from '../database/central-prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly centralPrisma: CentralPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('A valid bearer token is required');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      const principal = payload.isSuperAdmin
        ? await (this.centralPrisma as any).centralAdmin.findUnique({
            where: { id: payload.sub },
            select: { sessionVersion: true },
          })
        : await (this.centralPrisma as any).companyUser.findUnique({
            where: { id: payload.sub },
            select: { isActive: true, deletedAt: true, sessionVersion: true, identitySyncPending: true },
          });
      if (
        !principal
        || (!payload.isSuperAdmin && (!principal.isActive || principal.deletedAt))
        || Number(principal.sessionVersion || 0) !== Number(payload.sessionVersion || 0)
      ) {
        throw new UnauthorizedException('The session has been revoked');
      }
      if (principal.identitySyncPending) {
        throw new ServiceUnavailableException('Account update saved; access is paused until synchronization completes');
      }
      request.user = { ...payload, id: payload.sub };
      return true;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnauthorizedException('The access token is invalid or expired');
    }
  }
}
