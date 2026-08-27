import {
  IsEmail,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  STRONG_PASSWORD_MESSAGE,
  STRONG_PASSWORD_PATTERN,
} from '../../../common/security/password-policy';

export class UpdateCompanySettingsDto {
  @IsOptional() @IsString() @MaxLength(160) companyName?: string;
  @IsOptional() @IsString() @MaxLength(2048) logoUrl?: string;
  @IsOptional() @IsEmail() companyEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) companyPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) companyAddress?: string;
  @IsOptional() @IsString() @MaxLength(2000) companyDescription?: string;
  @IsOptional() @IsBoolean() automaticRentInvoices?: boolean;
  @IsOptional() @IsBoolean() automaticPayrollDrafts?: boolean;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(2048) avatarUrl?: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString()
  @Matches(STRONG_PASSWORD_PATTERN, { message: STRONG_PASSWORD_MESSAGE })
  newPassword: string;
}

export class EmailVerificationDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MaxLength(200) currentPassword: string;
}

export class ChangeEmailDto extends EmailVerificationDto {
  @IsString() @Matches(/^\d{6}$/) verificationCode: string;
}

export class UpdateLanguageDto {
  @IsIn(['en', 'so']) language: 'en' | 'so';
}
