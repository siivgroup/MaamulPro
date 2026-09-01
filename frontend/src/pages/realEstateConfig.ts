import { CrudField } from './CrudPage';

const options = (values: string[]) => values.map((value) => ({ value, label: value.replace(/_/g, ' ') }));

export const propertyFields: CrudField[] = [
    { name: 'title', label: 'Title', required: true, placeholder: 'Guri 4-qol ah oo Hodan ku yaal' },
    { name: 'type', label: 'Type', type: 'select', required: true, options: options(['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL']) },
    { name: 'price', label: 'Price', type: 'number', required: true, placeholder: '85000' },
    { name: 'area', label: 'Area', type: 'number', placeholder: '180' },
    { name: 'bedrooms', label: 'Bedrooms', type: 'number', placeholder: '4' },
    { name: 'bathrooms', label: 'Bathrooms', type: 'number', placeholder: '3' },
    { name: 'address', label: 'Address', placeholder: 'Waddada Maka Al-Mukarama, Muqdisho' },
    { name: 'imageUrl', label: 'Property image', type: 'image', uploadFolder: 'properties' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Ku sharax xaaladda, adeegyada, iyo muuqaalada hantida.' },
];

// Compact essentials for inline creation (no image, no long description); the property record can be enriched later on its detail page.
const propertyQuickFields: CrudField[] = [
    { name: 'title', label: 'Title', required: true, placeholder: 'Guri 4-qol ah oo Hodan ku yaal' },
    { name: 'type', label: 'Type', type: 'select', required: true, options: options(['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL']) },
    { name: 'price', label: 'Price', type: 'number', required: true, placeholder: '85000' },
    { name: 'address', label: 'Address', placeholder: 'Waddada Maka Al-Mukarama, Muqdisho' },
];

export const clientFields: CrudField[] = [
    { name: 'name', label: 'Name', required: true, placeholder: 'Aamina Maxamed' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'aamina@tusaale.so' },
    { name: 'phone', label: 'Phone', placeholder: '+252 61 234 5678' },
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Faahfaahin dheeraad ah oo ku saabsan macmiilka.' },
];

export const dealFields: CrudField[] = [
    { name: 'propertyId', label: 'Property', required: true, lookup: { endpoint: '/api/real-estate/properties/options', labelKeys: ['title'], create: { fields: propertyQuickFields, permission: 'properties.create' } } },
    { name: 'clientId', label: 'Buyer', required: true, lookup: { endpoint: '/api/real-estate/tenants/options', labelKeys: ['name'], create: { fields: clientFields, permission: ['clients.create', 'rentals.create'] } } },
    { name: 'totalAmount', label: 'Sale price', type: 'number', required: true, placeholder: '85000' },
    { name: 'paidAmount', label: 'Amount received', type: 'number', placeholder: '25000' },
    { name: 'closedAt', label: 'Sale date', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const tenantFields: CrudField[] = [
    { name: 'name', label: 'Name', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'nationalIdPassport', label: 'National ID / Passport' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const rentalContractFields: CrudField[] = [
    { name: 'tenantId', label: 'Tenant', required: true, lookup: { endpoint: '/api/real-estate/tenants/options', labelKeys: ['name'], create: { fields: tenantFields, permission: ['clients.create', 'rentals.create'] } } },
    { name: 'propertyId', label: 'Property', required: true, lookup: { endpoint: '/api/real-estate/properties/options', labelKeys: ['title'], create: { fields: propertyQuickFields, permission: 'properties.create' } } },
    { name: 'monthlyRent', label: 'Monthly rent', type: 'number', required: true },
    { name: 'startDate', label: 'Start date', type: 'date', required: true },
    { name: 'endDate', label: 'End date', type: 'date', required: true },
    { name: 'renewalDate', label: 'Renewal date', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const rentPaymentFields: CrudField[] = [
    { name: 'contractId', label: 'Rental contract', lookup: { endpoint: '/api/real-estate/rental-contracts', labelKeys: ['tenant.name', 'property.title', 'startDate'], populate: { tenantId: 'tenantId', monthlyRent: 'amountDue' } } },
    { name: 'tenantId', label: 'Tenant', required: true, lookup: { endpoint: '/api/real-estate/tenants/options', labelKeys: ['name'] } },
    { name: 'dueDate', label: 'Due date', type: 'date', required: true },
    { name: 'paidDate', label: 'Paid date', type: 'date', defaultToday: true, hideWhen: (form) => !Number(form.amountPaid) },
    { name: 'amountDue', label: 'Amount due', type: 'number', required: true },
    { name: 'amountPaid', label: 'Amount paid', type: 'number' },
    { name: 'receiptNo', label: 'Receipt number' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];
