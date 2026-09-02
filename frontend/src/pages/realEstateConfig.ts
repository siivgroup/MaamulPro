import { CrudField } from './CrudPage';

const options = (values: string[]) => values.map((value) => ({ value, label: value.replace(/_/g, ' ') }));

export const propertyTypeOptions = [
    { value: 'RENT', label: 'Rent' },
    { value: 'SALE', label: 'Sale' },
];

export const propertyFields: CrudField[] = [
    { name: 'title', label: 'Title', required: true, placeholder: 'Property name' },
    { name: 'type', label: 'Type', type: 'select', required: true, options: propertyTypeOptions },
    { name: 'price', label: 'Price', type: 'number', required: true, placeholder: '85000', hideWhen: (form) => form.type === 'RENT' },
    { name: 'floors', label: 'Floors', type: 'number', placeholder: '5' },
    { name: 'area', label: 'Area (sq m)', type: 'number', placeholder: '180' },
    { name: 'address', label: 'Address', placeholder: 'Waddada Maka Al-Mukarama, Muqdisho' },
    { name: 'imageUrl', label: 'Property image', type: 'image', uploadFolder: 'properties' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Ku sharax xaaladda, adeegyada, iyo muuqaalada hantida.' },
];

// Compact essentials for inline creation (no image, no long description); the property record can be enriched later on its detail page.
const propertyQuickFields: CrudField[] = [
    { name: 'title', label: 'Title', required: true, placeholder: 'Property name' },
    { name: 'type', label: 'Type', type: 'select', required: true, options: propertyTypeOptions },
    { name: 'price', label: 'Price', type: 'number', required: true, placeholder: '8500', hideWhen: (form) => form.type === 'RENT' },
    { name: 'floors', label: 'Floors', type: 'number', placeholder: '5' },
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
    { name: 'totalAmount', label: 'Sale price', type: 'number', required: true, placeholder: '8500' },
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

export const rentalUnitCategoryFields: CrudField[] = [
    { name: 'name', label: 'Category name', required: true, placeholder: 'One bedroom apartment' },
    { name: 'rooms', label: 'Rooms', type: 'number', required: true, placeholder: '3' },
    { name: 'bathrooms', label: 'Bathrooms', type: 'number', required: true, placeholder: '2' },
    { name: 'monthlyRent', label: 'Rent fee', type: 'number', required: true, placeholder: '500' },
    { name: 'section', label: 'Section', required: true, placeholder: 'Residential' },
];

export const rentalContractFields: CrudField[] = [
    { name: 'propertyId', label: 'Property', required: true, lookup: { endpoint: '/api/real-estate/properties/options', labelKeys: ['title'], create: { fields: propertyQuickFields, permission: 'properties.create' } } },
    { name: 'unitId', label: 'Unit', required: true, lookup: { endpoint: '/api/real-estate/units/options', labelKeys: ['name', 'status', 'monthlyRent'], populate: { monthlyRent: 'monthlyRent' }, filterBy: { field: 'propertyId', foreignKey: 'propertyId' }, filter: (row, form) => row.status === 'AVAILABLE' || row.id === form.unitId } },
    { name: 'tenantId', label: 'Tenant', required: true, lookup: { endpoint: '/api/real-estate/tenants/options', labelKeys: ['name'], create: { fields: tenantFields, permission: ['clients.create', 'rentals.create'] } } },
    { name: 'monthlyRent', label: 'Monthly rent', type: 'number', required: true },
    { name: 'billingPeriod', label: 'Billing period', type: 'select', required: true, options: options(['MONTHLY', 'QUARTERLY', 'YEARLY']) },
    { name: 'startDate', label: 'Start date', type: 'date', required: true },
    { name: 'endDate', label: 'End date', type: 'date' },
    { name: 'renewalDate', label: 'Renewal date', type: 'date' },
    { name: 'documentUrl', label: 'Lease document', type: 'file', uploadFolder: 'contracts' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
];

