import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { del, get, put } from '@vercel/blob';
import { randomUUID } from 'crypto';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_FOLDERS = new Set(['avatars', 'staff', 'projects', 'properties', 'materials', 'branding', 'contracts', 'documents']);
const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const DOCUMENT_ENTITIES = new Set(['workforce_contract', 'rental_contract', 'payroll', 'journal_batch']);

@Injectable()
export class UploadsService {
  async uploadDocument(tenantDb: any, file: any, entityType: string, entityId: string, companyId: string, userId: string) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Persistent blob storage is not configured');
    if (!file) throw new BadRequestException('Document file is required');
    if (!DOCUMENT_ENTITIES.has(entityType)) throw new BadRequestException('Unsupported document entity');
    const modelName = ({ workforce_contract: 'workforceContract', rental_contract: 'rentalContract', payroll: 'payroll', journal_batch: 'journalBatch' } as Record<string, string>)[entityType];
    const entity = await tenantDb[modelName].findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } });
    if (!entity) throw new NotFoundException('Document parent record was not found');
    if (!ALLOWED_DOCUMENT_TYPES.has(file.mimetype)) throw new BadRequestException('Only PDF, DOCX and XLSX documents are allowed');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('Document must be 10 MB or smaller');
    const valid = file.mimetype === 'application/pdf'
      ? file.buffer.subarray(0, 5).toString('ascii') === '%PDF-'
      : file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (!valid) throw new BadRequestException('Document content does not match its file type');
    const extension = file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype.includes('wordprocessing') ? 'docx' : 'xlsx';
    const pathname = `${companyId}/documents/${entityType}/${entityId}/${Date.now()}-${randomUUID()}.${extension}`;
    const blob = await put(pathname, file.buffer, { access: 'public', addRandomSuffix: false, token, contentType: file.mimetype });
    return tenantDb.documentAttachment.create({
      data: { entityType, entityId, filename: file.originalname || `document.${extension}`, url: blob.url, contentType: file.mimetype, size: file.size, uploadedById: userId },
      include: { uploadedBy: { select: { name: true } }, signedBy: { select: { name: true } } },
    });
  }

  listDocuments(tenantDb: any, entityType: string, entityId: string) {
    if (!DOCUMENT_ENTITIES.has(entityType)) throw new BadRequestException('Unsupported document entity');
    return tenantDb.documentAttachment.findMany({
      where: { entityType, entityId },
      include: { uploadedBy: { select: { name: true } }, signedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async signDocument(tenantDb: any, id: string, userId: string) {
    const document = await tenantDb.documentAttachment.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document was not found');
    if (document.signedAt) throw new BadRequestException('Document is already signed');
    return tenantDb.documentAttachment.update({ where: { id }, data: { signedAt: new Date(), signedById: userId } });
  }

  async uploadImage(file: any, folder: string | undefined, companyId?: string) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Persistent blob storage is not configured');
    if (!file) throw new BadRequestException('Image file is required');
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP and GIF images are allowed');
    }
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Image must be 5 MB or smaller');
    const detectedType = this.detectImageType(file.buffer);
    if (!detectedType || detectedType.mimetype !== file.mimetype) {
      throw new BadRequestException('The uploaded file content does not match its image type');
    }
    const safeFolder = folder && ALLOWED_FOLDERS.has(folder) ? folder : 'uploads';
    const extension = detectedType.extension;
    const owner = companyId || 'platform';
    const pathname = `${owner}/${safeFolder}/${Date.now()}-${randomUUID()}.${extension}`;
    const blob = await put(pathname, file.buffer, {
      access: 'public',
      addRandomSuffix: false,
      token,
      contentType: file.mimetype,
    });
    return { url: blob.url, pathname: blob.pathname, contentType: blob.contentType };
  }

  async uploadFile(file: any, folder: string | undefined, companyId?: string) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Persistent blob storage is not configured');
    if (!file) throw new BadRequestException('File is required');
    const allowed = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Allowed file types: PDF, Word (DOC/DOCX), Excel (XLSX), or Images (PNG/JPG)');
    }
    if (file.size > 15 * 1024 * 1024) throw new BadRequestException('File must be 15 MB or smaller');
    const safeFolder = folder && ALLOWED_FOLDERS.has(folder) ? folder : 'documents';
    const ext = file.originalname?.split('.').pop() || (file.mimetype === 'application/pdf' ? 'pdf' : 'bin');
    const owner = companyId || 'platform';
    const pathname = `${owner}/${safeFolder}/${Date.now()}-${randomUUID()}.${ext}`;
    const blob = await put(pathname, file.buffer, {
      access: 'public',
      addRandomSuffix: false,
      token,
      contentType: file.mimetype,
    });
    return { url: blob.url, pathname: blob.pathname, contentType: blob.contentType, filename: file.originalname };
  }

  async readPrivateImage(url: string, companyId?: string, isSuperAdmin = false) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Persistent blob storage is not configured');
    const pathname = this.ownedPathname(url, companyId, isSuperAdmin);
    let blob: any;
    try {
      blob = await get(pathname, { access: 'public', token });
    } catch {
      blob = await get(pathname, { access: 'private', token });
    }
    if (!blob?.stream) throw new NotFoundException('Image was not found');
    return blob;
  }


  async deleteImage(url: string, companyId?: string, isSuperAdmin = false) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Persistent blob storage is not configured');
    this.ownedPathname(url, companyId, isSuperAdmin);
    await del(url, { token });
    return { deleted: true };
  }

  private ownedPathname(url: string, companyId?: string, isSuperAdmin = false) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid blob URL');
    }
    if (!parsed.hostname.endsWith('.blob.vercel-storage.com')) {
      throw new BadRequestException('Only managed Vercel Blob images are supported');
    }
    const pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!isSuperAdmin && (!companyId || !pathname.startsWith(`${companyId}/`))) {
      throw new BadRequestException('Image does not belong to the signed-in company');
    }
    return pathname;
  }

  private detectImageType(buffer: Buffer): { mimetype: string; extension: string } | null {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return { mimetype: 'image/jpeg', extension: 'jpg' };
    }
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { mimetype: 'image/png', extension: 'png' };
    }
    const header = buffer.subarray(0, 12).toString('ascii');
    if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
      return { mimetype: 'image/gif', extension: 'gif' };
    }
    if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
      return { mimetype: 'image/webp', extension: 'webp' };
    }
    return null;
  }
}
