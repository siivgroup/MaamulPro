import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDate, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class MaterialDto {
  @IsString() @MaxLength(180) name: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @IsString() @MaxLength(120) materialType?: string;
  @IsOptional() @IsString() @MaxLength(2048) photoUrl?: string;
  @IsIn(['KG', 'BAG', 'PIECE', 'METER', 'LITER', 'TON', 'TRUCK_LOAD', 'LOT', 'SQUARE_METER', 'SET', 'BUCKET']) unit: string;
  @Type(() => Number) @IsNumber() @Min(0) unitCost: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) salePrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsString() @MaxLength(160) warehouse?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) lowStockThreshold?: number;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'DISCONTINUED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class SupplierDto {
  @IsString() @MaxLength(180) name: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) balance?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class PurchaseItemDto {
  @IsString() materialId: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) quantity: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost: number;
}

export class PurchaseOrderDto {
  @IsString() @MaxLength(120) orderNo: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsIn(['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED']) status?: string;
  @IsOptional() @Type(() => Date) @IsDate() orderedAt?: Date;
  @IsOptional() @Type(() => Date) @IsDate() receivedAt?: Date;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items: PurchaseItemDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class PurchaseStatusDto {
  @IsIn(['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED']) status: string;
}

export class SupplierPaymentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsString() @MaxLength(120) referenceNo: string;
  @IsOptional() @IsString() @MaxLength(80) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class MaterialCustomerDto {
  @IsString() @MaxLength(180) name: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @Type(() => Number) @IsNumber() balance?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class SaleItemDto {
  @IsString() materialId: string;
  @Type(() => Number) @IsNumber() @Min(0.01) quantity: number;
  @Type(() => Number) @IsNumber() @Min(0) unitPrice: number;
}

export class MaterialSaleDto {
  @IsString() @MaxLength(120) invoiceNo: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) paidAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) discountPercent?: number;
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SaleItemDto) items: SaleItemDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class TransportationDto {
  @IsString() @MaxLength(120) deliveryNo: string;
  @IsString() @MaxLength(180) responsiblePerson: string;
  @Type(() => Number) @IsNumber() @Min(0) cost: number;
  @IsOptional() @IsIn(['PENDING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']) status?: string;
  @IsOptional() @Type(() => Date) @IsDate() deliveryDate?: Date;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsString() materialId: string;
  @Type(() => Number) @IsNumber() @Min(0.01) quantity: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class TransportationStatusDto {
  @IsIn(['PENDING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']) status: string;
}
