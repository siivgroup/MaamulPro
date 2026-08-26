import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CentralPrismaService } from '../database/central-prisma.service';
import { TenantConnectionManager } from '../database/tenant-connection.manager';
import { isIP } from 'node:net';
import { revealDatabaseUrl } from '../database/database-credentials';
import { PlanEntitlements } from '../subscriptions/entitlement-policy';
import { SubscriptionEntitlementService } from '../subscriptions/subscription-entitlement.service';

export interface TenantContext {
  companyId: string;
  subdomain: string;
  companyName: string;
  status: string;
  mode: string;
  constructionEnabled: boolean;
  realEstateEnabled: boolean;
  materialManagementEnabled: boolean;
  subscriptionStatus: string;
  subscriptionExpiresAt?: Date | null;
  accessGranted: boolean;
  entitlements: PlanEntitlements;
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
      tenantDb?: any;
      user?: any;
    }
  }
}

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantResolverMiddleware.name);

  constructor(
    private readonly centralPrisma: CentralPrismaService,
    private readonly tenantManager: TenantConnectionManager,
    private readonly subscriptionEntitlements: SubscriptionEntitlementService,
  ) {}

  private get central(): any {
    return this.centralPrisma as any;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    if (
      req.path.startsWith('/api/superadmin') ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/sign-in') ||
      req.path.startsWith('/health')
    ) {
      return next();
    }

    const companyIdHeader = (req.headers['x-company-id'] || req.headers['x-tenant-id']) as string;
    const host = req.headers.host || '';
    const hostname = host.replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
    const subdomain = hostname.includes('.') && !isIP(hostname) ? hostname.split('.')[0] : null;

    let company: any = null;

    if (companyIdHeader) {
      company = await this.central.company.findUnique({
        where: { id: companyIdHeader },
      });
    } else if (subdomain && subdomain !== 'localhost' && subdomain !== 'www' && subdomain !== 'app' && subdomain !== 'admin') {
      company = await this.central.company.findUnique({
        where: { subdomain },
      });
    }

    if (company) {
      const tenantCtx: TenantContext = {
        companyId: company.id,
        subdomain: company.subdomain,
        companyName: company.name,
        status: company.status,
        mode: company.mode,
        constructionEnabled: company.constructionEnabled,
        realEstateEnabled: company.realEstateEnabled,
        materialManagementEnabled: company.materialManagementEnabled,
        subscriptionStatus: company.subscriptionStatus,
        subscriptionExpiresAt: company.subscriptionExpiresAt,
        accessGranted: company.accessGranted,
        entitlements: this.subscriptionEntitlements.fromCompany(company),
      };

      req.tenantContext = tenantCtx;
      if (company.dbUrl) {
        try {
          req.tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
        } catch (error: any) {
          this.logger.error(`Failed to instantiate tenant db client for ${company.name}: ${error.message}`);
        }
      }
    }

    next();
  }
}
