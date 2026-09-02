import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { GetTenantContext, GetTenantDb } from '../../common/decorators/tenant-context.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import {
  DealDto,
  PropertyDto,
  RentalUnitDto,
  RentalUnitCategoryDto,
  RentalContractDto,
  RentalContractStatusDto,
  RentReceiptDto,
  RentPaymentDto,
  TenantDto,
} from './real-estate.dto';
import { RealEstateService } from './real-estate.service';

@Controller('api/real-estate')
@UseGuards(TenantAccessGuard)
export class RealEstateController {
  constructor(private readonly service: RealEstateService) {}

  @Get('properties')
  @RequirePermissions('properties.read')
  getProperties(
    @GetTenantDb() db: any,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.service.getProperties(db, { type, status, search });
  }

  @Get('properties/options')
  @RequireAnyPermission('properties.read', 'deals.create', 'rentals.read', 'rentals.create')
  getPropertyOptions(@GetTenantDb() db: any) {
    return this.service.getPropertyOptions(db);
  }

  @Post('properties')
  @RequirePermissions('properties.create')
  createProperty(
    @GetTenantDb() db: any,
    @GetTenantContext('companyId') companyId: string,
    @Body() body: PropertyDto,
  ) {
    return this.service.createProperty(db, companyId, body);
  }

  @Get('properties/:id')
  @RequirePermissions('properties.read')
  getProperty(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getProperty(db, id);
  }

  @Patch('properties/:id')
  @RequirePermissions('properties.update')
  updateProperty(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: PropertyDto) {
    return this.service.updateProperty(db, id, body);
  }

  @Delete('properties/:id')
  @RequirePermissions('properties.delete')
  deleteProperty(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteProperty(db, id);
  }

  @Get('units')
  @RequirePermissions('rentals.read')
  getRentalUnits(@GetTenantDb() db: any, @Query('propertyId') propertyId?: string) {
    return this.service.getRentalUnits(db, propertyId);
  }

  @Get('units/options')
  @RequireAnyPermission('rentals.read', 'rentals.create')
  getRentalUnitOptions(@GetTenantDb() db: any, @Query('propertyId') propertyId?: string) {
    return this.service.getRentalUnitOptions(db, propertyId);
  }

  @Post('properties/:id/units')
  @RequirePermissions('properties.update')
  createRentalUnits(@GetTenantDb() db: any, @Param('id') id: string, @Body('units') units: RentalUnitDto[]) {
    return this.service.createRentalUnits(db, id, units || []);
  }

  @Patch('units/:id')
  @RequirePermissions('rentals.update')
  updateRentalUnit(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: RentalUnitDto) {
    return this.service.updateRentalUnit(db, id, body);
  }

  @Delete('units/:id')
  @RequirePermissions('rentals.delete')
  deleteRentalUnit(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteRentalUnit(db, id);
  }

  @Get('unit-categories')
  @RequirePermissions('rentals.read')
  getRentalUnitCategories(@GetTenantDb() db: any) {
    return this.service.getRentalUnitCategories(db);
  }

  @Post('unit-categories')
  @RequirePermissions('rentals.create')
  createRentalUnitCategory(@GetTenantDb() db: any, @Body() body: RentalUnitCategoryDto) {
    return this.service.createRentalUnitCategory(db, body);
  }

  @Patch('unit-categories/:id')
  @RequirePermissions('rentals.update')
  updateRentalUnitCategory(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: RentalUnitCategoryDto) {
    return this.service.updateRentalUnitCategory(db, id, body);
  }

  @Delete('unit-categories/:id')
  @RequirePermissions('rentals.delete')
  deleteRentalUnitCategory(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteRentalUnitCategory(db, id);
  }


  @Get('deals')
  @RequirePermissions('deals.read')
  getDeals(
    @GetTenantDb() db: any,
    @Query('propertyId') propertyId?: string,
    @Query('clientId') clientId?: string,
    @Query('paymentStatus') paymentStatus?: string,
  ) {
    return this.service.getDeals(db, { propertyId, clientId, paymentStatus });
  }

  @Post('deals')
  @RequirePermissions('deals.create')
  createDeal(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: DealDto,
  ) {
    return this.service.createDeal(db, userId, body);
  }

  @Get('deals/:id')
  @RequirePermissions('deals.read')
  getDeal(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getDeal(db, id);
  }

  @Patch('deals/:id')
  @RequirePermissions('deals.update')
  updateDeal(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: DealDto) {
    return this.service.updateDeal(db, id, body);
  }

  @Delete('deals/:id')
  @RequirePermissions('deals.delete')
  deleteDeal(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteDeal(db, id);
  }

  @Get('tenants')
  @RequireAnyPermission('clients.read', 'rentals.read')
  getTenants(@GetTenantDb() db: any) {
    return this.service.getTenants(db);
  }

  @Get('tenants/:id/rental-profile')
  @RequireAnyPermission('clients.read', 'rentals.read')
  getTenantRentalProfile(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getTenantRentalProfile(db, id);
  }

  @Get('tenants/options')
  @RequireAnyPermission('clients.read', 'rentals.read', 'deals.create', 'rentals.create')
  getTenantOptions(@GetTenantDb() db: any) {
    return this.service.getTenantOptions(db);
  }

  @Post('tenants')
  @RequireAnyPermission('clients.create', 'rentals.create')
  createTenant(@GetTenantDb() db: any, @Body() body: TenantDto) {
    return this.service.createTenant(db, body);
  }

  @Patch('tenants/:id')
  @RequireAnyPermission('clients.update', 'rentals.update')
  updateTenant(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: TenantDto) {
    return this.service.updateTenant(db, id, body);
  }

  @Delete('tenants/:id')
  @RequireAnyPermission('clients.delete', 'rentals.delete')
  deleteTenant(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteTenant(db, id);
  }

  @Get('rental-contracts')
  @RequirePermissions('rentals.read')
  getRentalContracts(@GetTenantDb() db: any) {
    return this.service.getRentalContracts(db);
  }

  @Post('rental-contracts')
  @RequirePermissions('rentals.create')
  createRentalContract(@GetTenantDb() db: any, @Body() body: RentalContractDto) {
    return this.service.createRentalContract(db, body);
  }

  @Patch('rental-contracts/:id')
  @RequirePermissions('rentals.update')
  updateRentalContract(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Body() body: RentalContractDto,
  ) {
    return this.service.updateRentalContract(db, id, body);
  }

  @Get('rentals/workspace')
  @RequirePermissions('rentals.read')
  async getRentalWorkspace(@GetTenantDb() db: any) {
    const [tenants, properties, units, contracts, payments] = await Promise.all([
      this.service.getTenants(db),
      this.service.getPropertyOptions(db),
      this.service.getRentalUnits(db),
      this.service.getRentalContracts(db),
      this.service.getRentPayments(db),
    ]);
    return { tenants, properties, units, contracts, payments };
  }

  @Post('rental-contracts/:id/status')
  @RequirePermissions('rentals.update')
  transitionRentalContract(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Body() body: RentalContractStatusDto,
  ) {
    return this.service.transitionRentalContract(db, id, body.status);
  }

  @Delete('rental-contracts/:id')
  @RequirePermissions('rentals.delete')
  deleteRentalContract(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteRentalContract(db, id);
  }

  @Get('rent-payments')
  @RequirePermissions('rentals.read')
  getRentPayments(@GetTenantDb() db: any, @Query('status') status?: string) {
    return this.service.getRentPayments(db, status);
  }

  @Post('generate-rent-invoices')
  @RequirePermissions('rentals.create')
  generateMonthlyRentInvoices(@GetTenantDb() db: any, @Body('date') date?: string) {
    return this.service.generateMonthlyRentInvoices(db, date);
  }

  @Post('rent-payments')
  @RequirePermissions('rentals.create')
  createRentPayment(@GetTenantDb() db: any, @Body() body: RentPaymentDto) {
    return this.service.createRentPayment(db, body);
  }

  @Post('rent-payments/:id/receipts')
  @RequirePermissions('rentals.create')
  recordRentReceipt(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: RentReceiptDto) {
    return this.service.recordRentReceipt(db, id, body);
  }

  @Patch('rent-payments/:id')
  @RequirePermissions('rentals.update')
  updateRentPayment(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: RentPaymentDto) {
    return this.service.updateRentPayment(db, id, body);
  }

  @Delete('rent-payments/:id')
  @RequirePermissions('rentals.delete')
  deleteRentPayment(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteRentPayment(db, id);
  }
}
