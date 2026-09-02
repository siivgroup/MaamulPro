import { CrudField } from './CrudPage';

const materialQuickFields: CrudField[] = [
    { name: 'name', label: 'Material name', required: true },
    { name: 'unit', label: 'Unit', type: 'select', required: true, options: ['BAG', 'KG', 'PIECE', 'METER', 'LITER', 'TON'].map((value) => ({ value, label: value })) },
    { name: 'unitCost', label: 'Unit cost ($)', type: 'number', required: true },
];
const supplierQuickFields: CrudField[] = [{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' }];
const customerQuickFields: CrudField[] = [{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' }];

export const materialFields: CrudField[] = [
    { name: 'name', label: 'Material name', required: true, placeholder: 'Sibidhka Dangote 50kg' },
    { name: 'unit', label: 'Unit', type: 'select', required: true, options: ['BAG', 'KG', 'PIECE', 'METER', 'LITER', 'TON'].map((value) => ({ value, label: value })) },
    { name: 'unitCost', label: 'Unit cost ($)', type: 'number', required: true, placeholder: '8.50' },
    { name: 'quantity', label: 'Opening stock quantity', type: 'number', placeholder: '100' },
    { name: 'lowStockThreshold', label: 'Low stock alert threshold', type: 'number', placeholder: '15' },
    { name: 'warehouse', label: 'Warehouse (Optional)', placeholder: 'Bakhaarka Weyn' },
    { name: 'category', label: 'Category (Optional)', placeholder: 'Sibidh / Dhismo' },
    { name: 'photoUrl', label: 'Product image (Optional)', type: 'image', uploadFolder: 'materials' },
];

export const supplierFields: CrudField[] = [
    { name: 'name', label: 'Name', required: true, placeholder: 'Dahabshiil Trade Co.' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'contact@supplier.so' },
    { name: 'phone', label: 'Phone', placeholder: '+252 61 555 0000' },
    { name: 'address', label: 'Address', placeholder: 'Bakhaaro, Muqdisho' },
    { name: 'balance', label: 'Opening balance', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const supplierEditFields = supplierFields.filter((field) => field.name !== 'balance');

export const purchaseFields: CrudField[] = [
    { name: 'orderNo', label: 'Order number', required: true, placeholder: 'PO-2026-001' },
    { name: 'supplierId', label: 'Supplier', required: true, lookup: { endpoint: '/api/materials/suppliers/options', labelKeys: ['name'], create: { fields: supplierQuickFields, permission: 'suppliers.create' } } },
    { name: 'orderedAt', label: 'Ordered date', type: 'date', defaultToday: true },
    { name: 'items', label: 'Purchase items', type: 'lineItems', required: true, lineItems: {
        endpoint: '/api/materials/products/options', idField: 'materialId', labelKeys: ['name', 'unit', 'status'], selectorLabel: 'Material',
        populate: { unitCost: 'unitCost' },
        fields: [{ name: 'quantity', label: 'Quantity', type: 'number', min: 0.01, required: true }, { name: 'unitCost', label: 'Unit cost', type: 'number', min: 0, required: true }],
    } },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const customerFields: CrudField[] = [
    { name: 'name', label: 'Name', required: true, placeholder: 'Cali Cabdi' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'cali@tusaale.so' },
    { name: 'phone', label: 'Phone', placeholder: '+252 61 234 5678' },
    { name: 'address', label: 'Address', placeholder: 'Hodan, Muqdisho' },
    { name: 'balance', label: 'Balance', type: 'number' },
];

export const saleFields: CrudField[] = [
    { name: 'invoiceNo', label: 'Invoice number', required: true, placeholder: 'INV-2026-001' },
    { name: 'customerId', label: 'Customer', lookup: { endpoint: '/api/materials/customers/options', labelKeys: ['name'], create: { fields: customerQuickFields, permission: 'material_sales.create' } } },
    { name: 'paidAmount', label: 'Paid amount', type: 'number' },
    { name: 'discountPercent', label: 'Discount %', type: 'number' },
    { name: 'date', label: 'Invoice date', type: 'date', defaultToday: true },
    { name: 'items', label: 'Invoice items', type: 'lineItems', required: true, lineItems: {
        endpoint: '/api/materials/products/options', idField: 'materialId', labelKeys: ['name'], selectorLabel: 'Material',
        populate: { salePrice: 'unitPrice' },
        fields: [{ name: 'quantity', label: 'Quantity', type: 'number', min: 0.01, required: true }, { name: 'unitPrice', label: 'Unit price', type: 'number', min: 0, required: true }],
    } },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const transportationFields: CrudField[] = [
    { name: 'deliveryNo', label: 'Delivery number', required: true, placeholder: 'DEL-2026-001' },
    { name: 'responsiblePerson', label: 'Responsible person', required: true, placeholder: 'Maxamed Axmed' },
    { name: 'materialId', label: 'Material', required: true, lookup: { endpoint: '/api/materials/products/options', labelKeys: ['name'], create: { fields: materialQuickFields, permission: 'materials_products.create' } } },
    { name: 'quantity', label: 'Quantity', type: 'number', required: true },
    { name: 'cost', label: 'Cost', type: 'number', required: true },
    { name: 'deliveryDate', label: 'Delivery date', type: 'date', defaultToday: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];

