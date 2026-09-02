import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { GetTenantDb } from '../../common/decorators/tenant-context.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import {
  MaterialCustomerDto,
  MaterialDto,
  MaterialSaleDto,
  PurchaseOrderDto,
  PurchaseStatusDto,
  SupplierDto,
  SupplierPaymentDto,
  TransportationDto,
  TransportationStatusDto,
} from './material-management.dto';
import { MaterialManagementService } from './material-management.service';

@Controller('api/materials')
@UseGuards(TenantAccessGuard)
export class MaterialManagementController {
  constructor(private readonly service: MaterialManagementService) {}

  @Get('products')
  @RequirePermissions('materials_products.read')
  getProducts(@GetTenantDb() db: any, @Query('search') search?: string) {
    return this.service.getProducts(db, search);
  }

  @Get('products/options')
  @RequireAnyPermission('materials_products.read', 'purchases.create', 'material_sales.create', 'transportation.create')
  getProductOptions(@GetTenantDb() db: any) { return this.service.getProductOptions(db); }

  @Get('products/:id')
  @RequirePermissions('materials_products.read')
  getProduct(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getProduct(db, id);
  }

  @Post('products')
  @RequirePermissions('materials_products.create')
  createProduct(@GetTenantDb() db: any, @Body() body: MaterialDto) {
    return this.service.createProduct(db, body);
  }

  @Patch('products/:id')
  @RequirePermissions('materials_products.update')
  updateProduct(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: MaterialDto) {
    return this.service.updateProduct(db, id, body);
  }

  @Delete('products/:id')
  @RequirePermissions('materials_products.delete')
  deleteProduct(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteProduct(db, id);
  }

  @Get('suppliers')
  @RequirePermissions('suppliers.read')
  getSuppliers(@GetTenantDb() db: any) { return this.service.getSuppliers(db); }

  @Get('suppliers/options')
  @RequireAnyPermission('suppliers.read', 'purchases.create')
  getSupplierOptions(@GetTenantDb() db: any) { return this.service.getSupplierOptions(db); }

  @Get('suppliers/:id')
  @RequirePermissions('suppliers.read')
  getSupplier(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getSupplier(db, id);
  }

  @Post('suppliers')
  @RequirePermissions('suppliers.create')
  createSupplier(@GetTenantDb() db: any, @CurrentUser('id') userId: string, @Body() body: SupplierDto) {
    return this.service.createSupplier(db, userId, body);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('suppliers.update')
  updateSupplier(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: SupplierDto) {
    return this.service.updateSupplier(db, id, body);
  }

  @Post('suppliers/:id/payments')
  @RequirePermissions('suppliers.update')
  recordSupplierPayment(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: SupplierPaymentDto,
  ) {
    return this.service.recordSupplierPayment(db, id, userId, body);
  }

  @Delete('suppliers/:id')
  @RequirePermissions('suppliers.delete')
  deleteSupplier(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteSupplier(db, id);
  }

  @Get('purchases')
  @RequirePermissions('purchases.read')
  getPurchaseOrders(@GetTenantDb() db: any) { return this.service.getPurchaseOrders(db); }

  @Get('purchases/:id')
  @RequirePermissions('purchases.read')
  getPurchaseOrder(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getPurchaseOrder(db, id);
  }

  @Patch('purchases/:id')
  @RequirePermissions('purchases.update')
  updatePurchaseOrder(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: PurchaseOrderDto,
  ) {
    return this.service.updatePurchaseOrder(db, id, userId, body);
  }

  @Post('purchases')
  @RequirePermissions('purchases.create')
  createPurchaseOrder(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: PurchaseOrderDto,
  ) {
    return this.service.createPurchaseOrder(db, userId, body);
  }

  @Post('purchases/:id/status')
  @RequirePermissions('purchases.update')
  updatePurchaseStatus(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: PurchaseStatusDto,
  ) {
    return this.service.updatePurchaseStatus(db, id, userId, body.status);
  }

  @Delete('purchases/:id')
  @RequirePermissions('purchases.delete')
  deletePurchaseOrder(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.deletePurchaseOrder(db, id, userId);
  }

  @Get('customers')
  @RequirePermissions('material_customers.read')
  getCustomers(@GetTenantDb() db: any) { return this.service.getCustomers(db); }

  @Get('customers/options')
  @RequireAnyPermission('material_customers.read', 'material_sales.create')
  getCustomerOptions(@GetTenantDb() db: any) { return this.service.getCustomerOptions(db); }

  @Get('customers/:id')
  @RequirePermissions('material_customers.read')
  getCustomer(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getCustomer(db, id);
  }

  @Post('customers')
  @RequirePermissions('material_sales.create')
  createCustomer(@GetTenantDb() db: any, @Body() body: MaterialCustomerDto) {
    return this.service.createCustomer(db, body);
  }

  @Patch('customers/:id')
  @RequirePermissions('material_customers.update')
  updateCustomer(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: MaterialCustomerDto) {
    return this.service.updateCustomer(db, id, body);
  }

  @Delete('customers/:id')
  @RequirePermissions('material_sales.delete')
  deleteCustomer(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteCustomer(db, id);
  }

  @Get('sales')
  @RequirePermissions('material_sales.read')
  getSales(@GetTenantDb() db: any) { return this.service.getSales(db); }

  @Get('sales/:id')
  @RequirePermissions('material_sales.read')
  getSale(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getSale(db, id);
  }

  @Post('sales')
  @RequirePermissions('material_sales.create')
  createSale(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: MaterialSaleDto,
  ) {
    return this.service.createSale(db, userId, body);
  }

  @Patch('sales/:id')
  @RequirePermissions('material_sales.update')
  updateSale(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: MaterialSaleDto,
  ) {
    return this.service.updateSale(db, id, userId, body);
  }

  @Delete('sales/:id')
  @RequirePermissions('material_sales.delete')
  deleteSale(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteSale(db, id, userId);
  }

  @Get('transportation')
  @RequirePermissions('transportation.read')
  getTransportation(@GetTenantDb() db: any) { return this.service.getTransportation(db); }

  @Get('transportation/:id')
  @RequirePermissions('transportation.read')
  getTransportationRecord(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.getTransportationRecord(db, id);
  }

  @Post('transportation')
  @RequirePermissions('transportation.create')
  createTransportation(@GetTenantDb() db: any, @Body() body: TransportationDto) {
    return this.service.createTransportation(db, body);
  }

  @Post('transportation/:id/status')
  @RequirePermissions('transportation.update')
  updateTransportationStatus(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Body() body: TransportationStatusDto,
  ) {
    return this.service.updateTransportationStatus(db, id, body.status);
  }

  @Patch('transportation/:id')
  @RequirePermissions('transportation.update')
  updateTransportation(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Body() body: TransportationDto,
  ) {
    return this.service.updateTransportation(db, id, body);
  }

  @Delete('transportation/:id')
  @RequirePermissions('transportation.delete')
  deleteTransportation(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.service.deleteTransportation(db, id);
  }
}
