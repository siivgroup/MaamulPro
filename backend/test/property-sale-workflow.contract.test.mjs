import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('property sales cannot create rental deals', () => {
  const dto = read('src/modules/real-estate/real-estate.dto.ts');
  const service = read('src/modules/real-estate/real-estate.service.ts');
  const form = read('../frontend/src/pages/realEstateConfig.ts');

  assert.match(dto, /@IsOptional\(\) @IsIn\(\['SALE'\]\) type\?: string/);
  assert.match(service, /const where: any = \{ deletedAt: null, type: 'SALE' \}/);
  assert.match(service, /type: 'SALE'/);
  assert.match(service, /Legacy rental record is read-only/);
  assert.doesNotMatch(form, /options\(\['SALE', 'RENTAL'\]\)/);
});
