import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTableMenuUrl, filterSelectableTables, resolveTableSelection } from '@/lib/table-helpers';
import type { ShopTable } from '@/types/qlaok';

const table = (id: string, shop: string, sort: number, extra: Partial<ShopTable> = {}): ShopTable => ({
  id, shop_id: shop, table_code: id, name: id, section: '', capacity: 4,
  sort_order: sort, is_active: true, is_archived: false, ...extra,
});

test('selectable tables exclude other shops, archived and inactive records without mutating input', () => {
  const rows = [
    table('T02', 'shop-a', 2), table('T01', 'shop-a', 1),
    table('foreign', 'shop-b', 0), table('inactive', 'shop-a', 0, { is_active: false }),
    table('archived', 'shop-a', 0, { is_archived: true }),
  ];
  const originalOrder = rows.map(row => row.id);
  assert.deepEqual(filterSelectableTables(rows, 'shop-a').map(row => row.id), ['T01', 'T02']);
  assert.deepEqual(rows.map(row => row.id), originalOrder);
  assert.deepEqual(filterSelectableTables(undefined, 'shop-a'), []);
});

test('table QR URL round-trips reserved characters and selection uses stable ID before legacy labels', () => {
  const selected = table('id?&=/#', 'shop-a', 1, { table_code: 'T01', name: 'Bàn cửa sổ' });
  const url = new URL(buildTableMenuUrl('https://fixture.example/', 'quán có dấu', selected.id));
  assert.equal(decodeURIComponent(url.pathname), '/s/quán có dấu/menu');
  assert.equal(url.searchParams.get('tableId'), selected.id);
  assert.equal(url.searchParams.get('src'), 'table');
  assert.equal(resolveTableSelection([selected], { tableId: selected.id, table: 'unknown' }).table?.id, selected.id);
  assert.ok(resolveTableSelection([selected], { tableId: 'invalid', table: 'T01' }).error);
  assert.equal(resolveTableSelection([selected], { table: ' bàn cửa sổ ' }).table?.id, selected.id);
});
