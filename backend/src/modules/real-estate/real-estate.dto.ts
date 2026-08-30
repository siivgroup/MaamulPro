import { Type } from 'class-transformer';
import { IsDate, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PropertyDto {
  @IsString() @MaxLength(200) title: string;
  @IsIn(['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL']) type: string;
  @IsOptional() @IsIn(['AVAILABLE', 'SOLD', 'RENTED', 'UNDER_CONTRACT']) status?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @Type(() => Number) @IsNumber() @Min(0) price: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) area?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bathrooms?: number;
  @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class DealDto {
  @IsString() propertyId: string;
  @IsString() clientId: string;
  @IsIn(['SALE', 'RENTAL']) type: string;
  @IsOptional() @IsIn(['PAID', 'PARTIAL', 'PENDING', 'OVERDUE', 'REFUNDED']) paymentStatus?: string;
  @Type(() => Number) @IsNumber() @Min(0.01) totalAmount: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) paidAmount?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @Type(() => Date) @IsDate() closedAt?: Date;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class TenantDto {
  @IsString() @MaxLength(160) name: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) nationalIdPassport?: string;
  @IsOptional() @IsString() propertyId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class RentalContractDto {
  @IsString() tenantId: string;
  @IsString() propertyId: string;
  @Type(() => Number) @IsNumber() @Min(0.01) monthlyRent: number;
  @Type(() => Date) @IsDate() startDate: Date;
  @Type(() => Date) @IsDate() endDate: Date;
  @IsOptional() @Type(() => Date) @IsDate() renewalDate?: Date;
  @IsOptional() @IsIn(['ACTIVE', 'EXPIRED', 'RENEWAL_DUE', 'TERMINATED']) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class RentalContractStatusDto {
  @IsIn(['ACTIVE', 'EXPIRED', 'RENEWAL_DUE', 'TERMINATED']) status: string;
}

export class RentPaymentDto {
  @IsString() tenantId: string;
  @IsOptional() @IsString() contractId?: string;
  @Type(() => Date) @IsDate() dueDate: Date;
  @IsOptional() @Type(() => Date) @IsDate() paidDate?: Date;
  @Type(() => Number) @IsNumber() @Min(0.01) amountDue: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amountPaid?: number;
  @IsOptional() @IsIn(['PAID', 'UNPAID', 'LATE', 'PARTIAL']) status?: string;
  @IsOptional() @IsString() @MaxLength(120) receiptNo?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class RentPaymentStatusDto {
  @IsIn(['PAID', 'UNPAID', 'LATE', 'PARTIAL']) status: string;
}
