import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ProjectDto {
  @IsString() @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @Type(() => Number) @IsNumber() @Min(0) budget: number;
  @IsOptional() @Type(() => Date) @IsDate() startDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() endDate?: Date;
  @IsOptional() @IsIn(['PLANNING', 'ONGOING', 'ON_HOLD', 'COMPLETED', 'CANCELLED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) progress?: number;
  @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string;
}

export class TaskDto {
  @IsString() projectId: string;
  @IsString() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']) status?: string;
  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) progress?: number;
  @IsOptional() @Type(() => Date) @IsDate() dueDate?: Date;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() staffId?: string;
}

export class WorkerTypeDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(32) color?: string;
}

export class ManpowerWorkerDto {
  @IsOptional() @IsString() linkedStaffId?: string;
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) position?: string;
  @IsOptional() @IsString() workerTypeId?: string;
  @IsOptional() @IsString() assignedProjectId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: string;
}

export class DailyExpenseDto {
  @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @IsString() @MaxLength(1000) description: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsOptional() @IsString() workerId?: string;
  @IsOptional() @IsString() projectId?: string;
}

export class WorkerLedgerDto {
  @IsIn(['INCOME', 'EXPENSE']) type: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @IsString() @MaxLength(1000) description: string;
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsOptional() @IsString() workerId?: string;
  @IsOptional() @IsString() projectId?: string;
}

export class InventoryMovementDto {
  @IsString() materialId: string;
  @IsIn(['RESTOCK', 'USAGE', 'ADJUSTMENT', 'TRANSFER']) type: string;
  @Type(() => Number) @IsNumber() @Min(0.01) quantity: number;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsString() @MaxLength(200) warehouse?: string;
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitCost?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalCost?: number;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(80) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(160) sourceRef?: string;
}

export class ConstructionMaterialDto {
  @IsString() @MaxLength(180) name: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @IsString() @MaxLength(120) materialType?: string;
  @IsOptional() @IsString() @MaxLength(2048) photoUrl?: string;
  @IsIn(['KG', 'BAG', 'PIECE', 'METER', 'LITER', 'TON', 'TRUCK_LOAD', 'LOT', 'SQUARE_METER', 'SET', 'BUCKET']) unit: string;
  @Type(() => Number) @IsNumber() @Min(0) unitCost: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsString() @MaxLength(160) warehouse?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) lowStockThreshold?: number;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'DISCONTINUED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class WorkforceContractDto {
  @IsString() projectId: string;
  @IsString() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(200) contractorName?: string;
  @Type(() => Number) @IsNumber() @Min(0) originalBudget: number;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'SUSPENDED']) status?: string;
  @IsOptional() @Type(() => Date) @IsDate() startDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() endDate?: Date;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}

export class ContractAssignmentDto {
  @IsString() workerId: string;
  @IsOptional() @IsString() @MaxLength(160) role?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ContractPaymentDto {
  @IsOptional() @IsString() workerId?: string;
  @IsOptional() @IsString() staffId?: string;
  @IsOptional() @IsString() @MaxLength(200) payeeName?: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsString() @MaxLength(1000) description: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ContractAdjustmentDto {
  @Type(() => Number) @IsNumber() amount: number;
  @IsString() @MaxLength(1000) reason: string;
}

export class ContractStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'SUSPENDED']) status: string;
}
