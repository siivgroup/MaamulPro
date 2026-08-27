import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import {
  STRONG_PASSWORD_MESSAGE,
  STRONG_PASSWORD_PATTERN,
} from '../../common/security/password-policy';

export class CreateCompanyDto {
  @IsUUID('4') onboardingRequestId: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() @Matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/) subdomain: string;
  @IsString() @MinLength(2) @MaxLength(120) adminName: string;
  @IsEmail() adminEmail: string;
  @IsString()
  @Matches(STRONG_PASSWORD_PATTERN, { message: STRONG_PASSWORD_MESSAGE })
  adminPassword: string;
  @IsOptional() @IsString() @Matches(/^postgres(?:ql)?:\/\//) @MaxLength(2000) dbUrl?: string;
  @IsOptional() @IsString() @MaxLength(80) companyType?: string;
  @IsOptional() @IsString() @MaxLength(500) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string;
  @IsOptional() @IsBoolean() constructionEnabled?: boolean;
  @IsOptional() @IsBoolean() realEstateEnabled?: boolean;
  @IsOptional() @IsBoolean() materialManagementEnabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) subscriptionAmount?: number;
  @IsOptional() @IsInt() @Min(1) subscriptionTermMonths?: number;
  @IsOptional() @IsBoolean() autoRecur?: boolean;
}

export class UpdateCompanyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]+$/, { message: 'Subdomain must contain only lowercase letters, numbers, and hyphens' }) @MaxLength(30) subdomain?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) adminName?: string;
  @IsOptional() @IsEmail() adminEmail?: string;

  @IsOptional() @IsString() @MaxLength(80) companyType?: string;
  @IsOptional() @IsString() @MaxLength(500) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string;
  @IsOptional() @IsBoolean() constructionEnabled?: boolean;
  @IsOptional() @IsBoolean() realEstateEnabled?: boolean;
  @IsOptional() @IsBoolean() materialManagementEnabled?: boolean;
}

export class InvoicePaymentDto {
  @IsOptional() @IsString() @MaxLength(80) paymentMethod?: string;
}

export class SubscriptionNotesDto {
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class AutoRenewDto {
  @IsBoolean() autoRenew: boolean;
}

export class ConfigureCompanySubscriptionDto {
  @IsUUID('4') requestId: string;
  @IsNumber() @Min(0) amount: number;
  @IsInt() @Min(1) termDurationMonths: number;
  @IsOptional() @IsBoolean() autoRecur?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
