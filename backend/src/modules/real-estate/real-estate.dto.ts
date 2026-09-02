import { Type } from 'class-transformer';
import { IsArray, IsDate, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class RentalUnitDto {
  @IsString() @MaxLength(120) name: string;
  @IsString() categoryId: string;
  @IsOptional() @IsString() @MaxLength(40) floor?: string;
  @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string;
  @IsOptional() @IsIn(['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE']) status?: string;
}

export class RentalUnitCategoryDto {
  @IsString() @MaxLength(120) name: string;
  @Type(() => Number) @IsInt() @Min(0) rooms: number;
  @Type(() => Number) @IsInt() @Min(0) bathrooms: number;
  @Type(() => Number) @IsNumber() @Min(0.01) monthlyRent: number;
  @IsString() @MaxLength(120) section: string;
}

export class PropertyDto {
  @IsString() @MaxLength(200) title: string;
  @IsIn(['RENT', 'SALE', 'HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL']) type: string;
  @IsOptional() @IsIn(['AVAILABLE', 'SOLD', 'RENTED', 'UNDER_CONTRACT']) status?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) area?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bathrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) floors?: number;
  @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RentalUnitDto) units?: RentalUnitDto[];
}

export class DealDto {
  @IsString() propertyId: string;
  @IsString() clientId: string;
  @IsOptional() @IsIn(['SALE']) type?: string;
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
  @IsString() unitId: string;
  @Type(() => Number) @IsNumber() @Min(0.01) monthlyRent: number;
  @IsOptional() @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY']) billingPeriod?: string;
  @Type(() => Date) @IsDate() startDate: Date;
  @IsOptional() @Type(() => Date) @IsDate() endDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() renewalDate?: Date;
  @IsOptional() @IsString() @MaxLength(2048) documentUrl?: string;
  @IsOptional() @IsIn(['ACTIVE', 'EXPIRED', 'RENEWAL_DUE', 'TERMINATED']) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class RentalContractStatusDto {
  @IsIn(['ACTIVE', 'EXPIRED', 'RENEWAL_DUE', 'TERMINATED']) status: string;
}

export class RentPaymentDto {
  @IsString() tenantId: string;
  @IsString() contractId: string;
  @Type(() => Date) @IsDate() dueDate: Date;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amountDue: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class RentReceiptDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @Type(() => Date) @IsDate() receivedAt?: Date;
  @IsOptional() @IsString() @MaxLength(120) receiptNo?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
