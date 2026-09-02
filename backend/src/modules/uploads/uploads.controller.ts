import { Body, Controller, Delete, Get, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Readable } from 'node:stream';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GetTenantDb } from '../../common/decorators/tenant-context.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { DeleteUploadDto } from './dto/delete-upload.dto';
import { UploadsService } from './uploads.service';

// Uploading and deleting company blobs requires write access to at least one of
// the features that persist images (staff/avatars, projects, properties,
// materials, branding). Reads stay open to any authenticated company user via
// the authenticated reader endpoint below.
const UPLOAD_WRITE_PERMISSIONS = [
  'projects.update',
  'properties.update',
  'materials_products.update',
  'construction_inventory.update',
  'users.update',
  'settings.update',
  'rentals.create',
  'rentals.update',
  'workforce_contracts.create',
  'workforce_contracts.update',
];

@UseGuards(TenantAccessGuard)
@Controller('api/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get('documents')
  @RequireAnyPermission('workforce_contracts.read', 'rentals.read', 'payroll.read', 'accounting.read')
  listDocuments(@GetTenantDb() db: any, @Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.uploads.listDocuments(db, entityType, entityId);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  @RequireAnyPermission('workforce_contracts.update', 'rentals.update', 'payroll.manage', 'accounting.post')
  uploadDocument(
    @GetTenantDb() db: any,
    @UploadedFile() file: any,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @CurrentUser() user: any,
  ) {
    return this.uploads.uploadDocument(db, file, entityType, entityId, user.companyId, user.id);
  }

  @Post('documents/sign')
  @RequireAnyPermission('workforce_contracts.update', 'rentals.update', 'payroll.approve', 'accounting.approve')
  signDocument(@GetTenantDb() db: any, @Body('id') id: string, @CurrentUser('id') userId: string) {
    return this.uploads.signDocument(db, id, userId);
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  @RequireAnyPermission(...UPLOAD_WRITE_PERMISSIONS)
  uploadFile(
    @UploadedFile() file: any,
    @Query('folder') folder: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.uploads.uploadFile(file, folder, user.companyId);
  }

  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @RequireAnyPermission(...UPLOAD_WRITE_PERMISSIONS)
  uploadImage(
    @UploadedFile() file: any,
    @Query('folder') folder: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.uploads.uploadImage(file, folder, user.companyId);
  }

  @Delete('images')
  @RequireAnyPermission(...UPLOAD_WRITE_PERMISSIONS)
  deleteImage(@Body() body: DeleteUploadDto, @CurrentUser() user: any) {
    return this.uploads.deleteImage(body.url, user.companyId, user.isSuperAdmin);
  }

  @Get('images/content')
  async readImage(
    @Query('url') url: string,
    @CurrentUser() user: any,
    @Res() response: Response,
  ) {
    const result = await this.uploads.readPrivateImage(
      url,
      user.companyId,
      user.isSuperAdmin,
    );
    response.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    response.setHeader('Cache-Control', 'private, max-age=300');
    Readable.fromWeb(result.stream as any).pipe(response);
  }
}
