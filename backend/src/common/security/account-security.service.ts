import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { CentralPrismaService } from '../database/central-prisma.service';
import { IdentitySyncService, identityChange } from '../database/identity-sync.service';
import { ResendEmailService } from '../email/resend-email.service';
import { assertStrongPassword } from './password-policy';

type Kind = 'admin' | 'user';
type Context = 'PASSWORD_RESET' | 'EMAIL_CHANGE' | 'COMPANY_ONBOARDING';
type Subject = { key: string; version: number };
const INVALID_CODE = 'Verification code is invalid, expired, or already used. Request a new code.';
export function normalizedEmail(value: string): string {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw new BadRequestException('A valid email address is required');
  return email;
}
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 200) return false;
  try { return hash.startsWith('$argon2') ? await argon2.verify(hash, password) : await bcrypt.compare(password, hash); }
  catch { return false; }
}

@Injectable()
export class AccountSecurityService {
  private readonly logger = new Logger(AccountSecurityService.name);
  constructor(private readonly central: CentralPrismaService, private readonly email: ResendEmailService, private readonly identities: IdentitySyncService) {}
  private model(db: any, kind: Kind) { return kind === 'admin' ? db.centralAdmin : db.companyUser; }
  private subject(kind: Kind, account: any): Subject { return { key: `${kind}:${account.id}`, version: account.sessionVersion }; }
  private async account(db: any, kind: Kind, id: string) {
    const account = await this.model(db, kind).findUnique({ where: { id }, ...(kind === 'user' ? { include: { company: true } } : {}) });
    if (!account || (kind === 'user' && (!account.isActive || account.deletedAt))) throw new BadRequestException('Account is not available');
    if (kind === 'user') {
      const setup = await db.companyOnboarding.findUnique({ where: { companyId: account.companyId } });
      if (setup && setup.status !== 'SUCCEEDED') throw new BadRequestException('Finish company setup before changing credentials.');
    }
    return account;
  }
  private async lockSubject(tx: any, subject: Subject) {
    const [kind, id] = subject.key.split(':') as [Kind, string];
    if (!['admin', 'user'].includes(kind) || !id) throw new BadRequestException(INVALID_CODE);
    await tx.$queryRawUnsafe(`SELECT id FROM ${kind === 'admin' ? 'central_admins' : 'company_users'} WHERE id = $1 FOR UPDATE`, id);
    const account = await this.account(tx, kind, id);
    if (account.sessionVersion !== subject.version) throw new BadRequestException('Account changed. Request a new code or sign in again.');
    return account;
  }
  private async lockChallenge(tx: any, email: string, context: Context) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `verification:${context}:${email}`);
  }
  async issue(emailInput: string, context: Context, subject?: Subject) {
    const email = normalizedEmail(emailInput);
    return (this.central as any).$transaction(async (tx: any) => {
      if (subject) await this.lockSubject(tx, subject);
      await this.lockChallenge(tx, email, context);
      const prior = await tx.emailVerification.findUnique({ where: { email_context: { email, context } } });
      const ttl = context === 'PASSWORD_RESET' ? 15 * 60_000 : 10 * 60_000;
      // expiresAt is fixed at issuance; failed attempts must not extend the cooldown.
      const wait = prior ? Math.ceil((new Date(prior.expiresAt).getTime() - ttl + 60_000 - Date.now()) / 1000) : 0;
      if (wait > 0) throw new BadRequestException(`Please wait ${wait} seconds before requesting another code`);
      const code = String(randomInt(100000, 1000000));
      const hashedCode = await argon2.hash(code);
      const expiresAt = new Date(Date.now() + ttl);
      const data = { hashedCode, expiresAt, status: 'PENDING', attempts: 0, verifiedAt: null, subjectKey: subject?.key || null, subjectVersion: subject?.version ?? null };
      await tx.emailVerification.upsert({ where: { email_context: { email, context } }, create: { email, context, ...data }, update: data });
      return { code, hashedCode, expiresAt };
    }, { timeout: 15000 });
  }
  async consume<T>(emailInput: string, context: Context, code: string, subject: Subject | undefined, change: (tx: any, account?: any) => Promise<T>): Promise<T> {
    const email = normalizedEmail(emailInput);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new BadRequestException(INVALID_CODE);
    const result = await (this.central as any).$transaction(async (tx: any) => {
      const account = subject ? await this.lockSubject(tx, subject) : undefined;
      await this.lockChallenge(tx, email, context);
      const row = await tx.emailVerification.findUnique({ where: { email_context: { email, context } } });
      if (!row || row.status !== 'PENDING' || row.expiresAt <= new Date() || row.attempts >= 5
        || row.subjectKey !== (subject?.key || null) || row.subjectVersion !== (subject?.version ?? null)) return { failure: INVALID_CODE };
      if (!(await argon2.verify(row.hashedCode, code))) {
        await tx.emailVerification.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, ...(row.attempts === 4 ? { status: 'FAILED' } : {}) } });
        return { failure: row.attempts === 4 ? 'Too many verification attempts. Request a new code.' : 'Verification code is incorrect.' };
      }
      if (row.expiresAt <= new Date()) return { failure: INVALID_CODE };
      const value = await change(tx, account);
      await tx.emailVerification.update({ where: { id: row.id }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
      return { value };
    }, { timeout: 15000 });
    // Throw outside the transaction so incorrect-attempt increments are committed.
    if (result.failure) throw new BadRequestException(result.failure);
    return result.value;
  }
  async deliverCode(email: string, context: Context, challenge: Awaited<ReturnType<AccountSecurityService['issue']>>, account?: any) {
    const delivery = await this.email.send({ to: [email], content: {
      template: context === 'PASSWORD_RESET' ? 'password-reset' : context === 'EMAIL_CHANGE' ? 'email-change' : 'onboarding-verification',
      recipient: email, name: account?.name, workspace: account?.company?.name,
      code: challenge.code, expiresAt: challenge.expiresAt,
    } });
    if (!delivery.sent) {
      await (this.central as any).emailVerification.updateMany({ where: { email, context, hashedCode: challenge.hashedCode, status: 'PENDING' }, data: { status: 'FAILED' } });
      throw new ServiceUnavailableException('Verification email could not be sent. Please try again later.');
    }
    return { sent: true, expiresAt: challenge.expiresAt, cooldownSeconds: 60 };
  }
  async requestPasswordReset(emailInput: string) {
    const email = normalizedEmail(emailInput);
    try {
      const db = this.central as any;
      const user = await db.companyUser.findFirst({ where: { email, isActive: true, deletedAt: null }, include: { company: true } });
      const admin = user ? null : await db.centralAdmin.findUnique({ where: { email } });
      if (user || admin) {
        const challenge = await this.issue(email, 'PASSWORD_RESET', this.subject(user ? 'user' : 'admin', user || admin));
        await this.deliverCode(email, 'PASSWORD_RESET', challenge, user || admin);
      }
    } catch { this.logger.warn('Password recovery request not sent; account and provider details withheld'); }
    return { accepted: true };
  }
  async resetPassword(emailInput: string, code: string, newPassword: string) {
    assertStrongPassword(newPassword);
    const email = normalizedEmail(emailInput), db = this.central as any;
    const user = await db.companyUser.findUnique({ where: { email } });
    const admin = user ? null : await db.centralAdmin.findUnique({ where: { email } });
    const account = user || admin;
    if (!account) throw new BadRequestException(INVALID_CODE);
    const kind: Kind = user ? 'user' : 'admin';
    const passwordHash = await argon2.hash(newPassword);
    const changed = await this.consume(email, 'PASSWORD_RESET', code, this.subject(kind, account), async (tx, current) => {
      if (current.email !== email) throw new BadRequestException(INVALID_CODE);
      await this.savePassword(tx, kind, current.id, passwordHash);
      return current;
    });
    const syncPending = kind === 'user' ? await this.identities.sync(account.id) : false;
    await this.notifyChange(changed, 'password', false, undefined, kind === 'admin');
    return { reset: true, syncPending, message: this.changeMessage(syncPending, 'Password reset') };
  }
  private async checkedAccount(kind: Kind, id: string, password: string) {
    const account = await this.account(this.central, kind, id);
    if (!(await verifyPassword(account.passwordHash, password))) throw new BadRequestException('Current password is incorrect');
    return account;
  }
  async assertAvailable(tx: any, email: string, kind: Kind, id: string) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `account-email:${email}`);
    const [admin, user] = await Promise.all([tx.centralAdmin.findUnique({ where: { email } }), tx.companyUser.findUnique({ where: { email } })]);
    if ((admin && (kind !== 'admin' || admin.id !== id)) || (user && (kind !== 'user' || user.id !== id))) throw new ConflictException('Email address is already in use');
  }
  async sendEmailChange(kind: Kind, id: string, emailInput: string, password: string) {
    const email = normalizedEmail(emailInput);
    const account = await this.checkedAccount(kind, id, password);
    if (account.email === email) throw new BadRequestException('Enter a different email address');
    await (this.central as any).$transaction((tx: any) => this.assertAvailable(tx, email, kind, id));
    const challenge = await this.issue(email, 'EMAIL_CHANGE', this.subject(kind, account));
    return this.deliverCode(email, 'EMAIL_CHANGE', challenge, account);
  }
  async changeEmail(kind: Kind, id: string, emailInput: string, password: string, code: string) {
    const email = normalizedEmail(emailInput);
    const account = await this.checkedAccount(kind, id, password);
    await this.consume(email, 'EMAIL_CHANGE', code, this.subject(kind, account), async (tx, current) => {
      await this.assertAvailable(tx, email, kind, id);
      await this.model(tx, kind).update({ where: { id }, data: { email, ...(kind === 'user' ? identityChange() : { sessionVersion: { increment: 1 } }) } });
      if (kind === 'user' && current.role === 'COMPANY_OWNER') await tx.company.update({ where: { id: current.companyId }, data: { adminEmail: email } });
    });
    const syncPending = kind === 'user' ? await this.identities.sync(id) : false;
    await this.notifyChange(account, 'email', false, email, kind === 'admin');
    return { updated: true, syncPending, message: this.changeMessage(syncPending, 'Login email updated') };
  }
  private savePassword(tx: any, kind: Kind, id: string, passwordHash: string) {
    return this.model(tx, kind).update({ where: { id }, data: {
      passwordHash, passwordResetAt: new Date(), resetTokenHash: null, resetTokenExpiresAt: null, resetRequestedAt: null,
      ...(kind === 'user' ? identityChange() : { sessionVersion: { increment: 1 } }),
    } });
  }
  async changePassword(kind: Kind, id: string, currentPassword: string, newPassword: string) {
    assertStrongPassword(newPassword);
    const account = await this.checkedAccount(kind, id, currentPassword);
    if (await verifyPassword(account.passwordHash, newPassword)) throw new BadRequestException('New password must be different');
    const passwordHash = await argon2.hash(newPassword);
    await (this.central as any).$transaction(async (tx: any) => {
      await this.lockSubject(tx, this.subject(kind, account));
      await this.savePassword(tx, kind, id, passwordHash);
    });
    const syncPending = kind === 'user' ? await this.identities.sync(id) : false;
    await this.notifyChange(account, 'password', false, undefined, kind === 'admin');
    return { changed: true, updated: true, syncPending, message: this.changeMessage(syncPending, 'Password updated') };
  }
  private changeMessage(pending: boolean, action: string) {
    return pending ? `${action}. Access is paused while the workspace synchronizes; sign in again shortly.` : `${action}. Sign in again.`;
  }
  async notifyChange(account: any, change: 'password' | 'email', administrator = false, newEmail?: string, admin = false) {
    // Notifications are best-effort AFTER commit; never turn a saved change into a reported failure.
    try {
      for (const recipient of new Set([account.email, ...(newEmail ? [newEmail] : [])])) {
        await this.email.send({ to: [recipient as string], content: { template: 'account-change', recipient: account.email, change, administrator, newEmail, admin, subdomain: account.company?.subdomain, changedAt: new Date() } });
      }
    } catch { this.logger.warn('Account change notification failed after commit'); }
  }
}
