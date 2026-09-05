import { CrudField } from './CrudPage';

const options = (values: string[]) => values.map((value) => ({ value, label: value.replace(/_/g, ' ') }));

export const projectFields: CrudField[] = [
    { name: 'name', label: 'Project name', required: true, placeholder: 'Dhismaha Xarunta Hodan' },
    { name: 'location', label: 'Location', placeholder: 'Hodan, Muqdisho' },
    { name: 'budget', label: 'Budget', type: 'number', required: true, placeholder: '250000' },
    { name: 'status', label: 'Status', type: 'select', options: options(['PLANNING', 'ONGOING', 'ON_HOLD', 'COMPLETED', 'CANCELLED']) },
    { name: 'startDate', label: 'Start date', type: 'date' },
    { name: 'endDate', label: 'End date', type: 'date' },
    { name: 'imageUrl', label: 'Project image', type: 'image', uploadFolder: 'projects' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Sharax ujeedada mashruuca iyo baaxaddiisa.' },
];

const projectQuickFields: CrudField[] = [
    { name: 'name', label: 'Project name', required: true, placeholder: 'Dhismaha Xarunta Hodan' },
    { name: 'budget', label: 'Budget', type: 'number', required: true, placeholder: '250000' },
];

const workerQuickFields: CrudField[] = [
    { name: 'linkedStaffId', label: 'Existing staff member', lookup: { endpoint: '/api/staff/options', labelKeys: ['firstName', 'lastName'] } },
    { name: 'firstName', label: 'First name' },
    { name: 'lastName', label: 'Last name' },
    { name: 'phone', label: 'Phone' },
    { name: 'position', label: 'Position' },
];

export const workerLookupField: CrudField = {
    name: 'workerId',
    label: 'Worker',
    lookup: {
        endpoint: '/api/construction/manpower/workers/options',
        labelKeys: ['firstName', 'lastName'],
        create: { endpoint: '/api/construction/manpower/workers', label: '+ Add new worker', fields: workerQuickFields, permission: 'manpower.create' },
    },
};

export const taskFields: CrudField[] = [
    { name: 'projectId', label: 'Project', required: true, lookup: { endpoint: '/api/construction/projects/options', labelKeys: ['name'], create: { fields: projectQuickFields, permission: 'projects.create' } } },
    { name: 'title', label: 'Task title', required: true, placeholder: 'Dhammaystir darbiga koowaad' },
    { name: 'status', label: 'Status', type: 'select', options: options(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']) },
    { name: 'priority', label: 'Priority', type: 'select', options: options(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) },
    { name: 'dueDate', label: 'Due date', type: 'date' },
    { name: 'staffId', label: 'Assigned staff member', lookup: { endpoint: '/api/staff/options', labelKeys: ['firstName', 'lastName'] } },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Sharax shaqada, natiijada la filayo, iyo wixii caqabad ah.' },
];

export const constructionMaterialFields: CrudField[] = [
    { name: 'name', label: 'Material name', required: true, placeholder: 'Sibidhka Dangote 50kg' },
    { name: 'unit', label: 'Unit', type: 'select', required: true, options: ['BAG', 'KG', 'PIECE', 'METER', 'LITER', 'TON'].map((value) => ({ value, label: value })) },
    { name: 'unitCost', label: 'Unit cost ($)', type: 'number', required: true, placeholder: '8.50' },
    { name: 'quantity', label: 'Opening stock quantity', type: 'number', placeholder: '100' },
    { name: 'lowStockThreshold', label: 'Low stock alert threshold', type: 'number', placeholder: '15' },
    { name: 'warehouse', label: 'Site / warehouse (Optional)', placeholder: 'Goobta mashruuca' },
    { name: 'category', label: 'Category (Optional)', placeholder: 'Sibidh / Dhismo' },
    { name: 'photoUrl', label: 'Material image (Optional)', type: 'image', uploadFolder: 'materials' },
];

export const expenseFields: CrudField[] = [
    { name: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '1500' },
    { name: 'description', label: 'Description', required: true, placeholder: 'Iibsiga sibidhka goobta' },
    { name: 'category', label: 'Category', required: true, lookup: { endpoint: '/api/construction/expenses/categories', valueKey: 'value', labelKeys: ['label'] } },
    { name: 'date', label: 'Date', type: 'date', defaultToday: true },
    { name: 'projectId', label: 'Project', lookup: { endpoint: '/api/construction/projects/options', labelKeys: ['name'], create: { fields: projectQuickFields, permission: 'projects.create' } } },
    { ...workerLookupField, required: true, hideWhen: (form) => form.category !== 'UNSKILLED_LABOR' },
];
