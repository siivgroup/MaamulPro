import { Injectable, NotFoundException } from '@nestjs/common';
import { ReportScheduleDto } from './reports.dto';
import { constructionExpenseCategory } from '../construction/construction-expense-categories';
import { projectProgress } from '../construction/construction-progress';

const REPORTS = [
  ['core-income', 'Income Report', 'core'],
  ['core-expense', 'Expense Report', 'core'],
  ['core-profit-summary', 'Profit Summary', 'core'],
  ['core-transaction-detail', 'Transaction Detail By Account', 'core'],
  ['construction-project-profit', 'Project Profit Report', 'construction'],
  ['construction-material-usage', 'Material Usage Report', 'construction'],
  ['construction-manpower-cost', 'Manpower Cost Report', 'construction'],
  ['construction-expenses', 'Construction Expense Report', 'construction'],
  ['construction-progress', 'Project Progress Analytics', 'construction'],
  ['construction-manpower-expenses', 'Manpower Expense Detail', 'construction'],
  ['construction-workforce-budget', 'Workforce Budget Report', 'construction'],
  ['real-estate-rental-income', 'Rental Income Report', 'real_estate'],
  ['real-estate-occupancy', 'Occupancy Report', 'real_estate'],
  ['real-estate-property-sales', 'Property Sales Report', 'real_estate'],
  ['real-estate-due-payments', 'Due Payment Report', 'real_estate'],
  ['real-estate-sales-performance', 'Sales Performance Report', 'real_estate'],
  ['material-stock-movement', 'Stock Movement Report', 'material_management'],
  ['material-purchases', 'Purchase Report', 'material_management'],
  ['material-supplier-balances', 'Supplier Balance Report', 'material_management'],
  ['material-sales', 'Material Sales Report', 'material_management'],
  ['material-estimated-profit', 'Estimated Profit Report', 'material_management'],
  ['payroll-summary', 'Payroll Summary', 'payroll'],
  ['payroll-payslips', 'Payslip Detail Report', 'payroll'],
  ['payroll-department-cost', 'Department Payroll Cost', 'payroll'],
].map(([id, title, workspace]) => ({ id, title, workspace, supportsDateRange: true, schedulingReady: true }));

@Injectable()
export class ReportsService {

  async compareReport(
    db: any,
    reportId: string,
    query: { startDate?: string; endDate?: string; compareStartDate?: string; compareEndDate?: string; entityId?: string; projectId?: string },
  ) {
    const current = await this.runReport(db, reportId, query);
    if (!query.compareStartDate && !query.compareEndDate) return current;
    const previous = await this.runReport(db, reportId, {
      ...query,
      startDate: query.compareStartDate,
      endDate: query.compareEndDate,
    });
    const summaryDelta = Object.fromEntries(Object.keys({ ...current.summary, ...previous.summary }).map((key) => [
      key,
      Number(current.summary[key] || 0) - Number(previous.summary[key] || 0),
    ]));
    return {
      ...current,
      comparison: {
        startDate: query.compareStartDate || null,
        endDate: query.compareEndDate || null,
        summary: previous.summary,
        summaryDelta,
        rowCount: previous.rows.length,
      },
    };
  }

  async exportReport(
    db: any,
    reportId: string,
    format: 'csv' | 'xls' | 'pdf',
    query: { startDate?: string; endDate?: string; entityId?: string; projectId?: string },
    branding?: { companyName: string; companyAddress: string; companyPhone: string; companyEmail: string },
  ) {
    const result = await this.runReport(db, reportId, query);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') return { filename: `${reportId}-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', content: Buffer.from(this.reportCsv(result), 'utf8') };
    if (format === 'xls') return { filename: `${reportId}-${stamp}.xls`, contentType: 'application/vnd.ms-excel; charset=utf-8', content: Buffer.from(this.reportSpreadsheetXml(result), 'utf8') };
    return { filename: `${reportId}-${stamp}.pdf`, contentType: 'application/pdf', content: this.reportPdf(result, branding) };
  }

  reportCsv(result: { report: { title: string }; summary: any; rows: any[] }) {
    const columns = Object.keys(result.rows[0] || {});
    const lines: string[][] = [
      [result.report.title], [], ['Metric', 'Value'],
      ...Object.entries(result.summary).map(([key, value]) => [key, this.exportValue(value)]),
      [], columns,
      ...result.rows.map((row) => columns.map((column) => this.exportValue(row[column]))),
    ];
    return lines.map((line) => line.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }

  private reportSpreadsheetXml(result: { report: { title: string }; summary: any; rows: any[] }) {
    const columns = Object.keys(result.rows[0] || {});
    const row = (values: any[]) => `<Row>${values.map((value) => `<Cell><Data ss:Type="String">${this.xmlEscape(this.exportValue(value))}</Data></Cell>`).join('')}</Row>`;
    return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${row([result.report.title])}${row([])}${row(['Metric', 'Value'])}${Object.entries(result.summary).map(([key, value]) => row([key, value])).join('')}${row([])}${row(columns)}${result.rows.map((item) => row(columns.map((column) => item[column]))).join('')}</Table></Worksheet></Workbook>`;
  }

  private reportPdf(
    result: { report: { title: string }; summary: any; rows: any[] },
    branding?: { companyName: string; companyAddress: string; companyPhone: string; companyEmail: string },
  ) {
    const sep = '-'.repeat(72);
    const brandLines: string[] = [];
    if (branding?.companyName) brandLines.push(branding.companyName);
    if (branding?.companyAddress) brandLines.push(branding.companyAddress);
    const contact = [branding?.companyPhone, branding?.companyEmail].filter(Boolean).join('  |  ');
    if (contact) brandLines.push(contact);
    if (brandLines.length) brandLines.push(sep);

    const lines = [
      ...brandLines,
      result.report.title,
      `Generated: ${new Date().toLocaleDateString()}`,
      sep,
      'SUMMARY',
      ...Object.entries(result.summary).map(([key, value]) => `  ${key}: ${this.exportValue(value)}`),
      sep,
      'DATA',
      ...result.rows.slice(0, 30).map((row) => Object.values(row).slice(0, 5).map((value) => this.exportValue(value)).join(' | ')),
      sep,
      branding?.companyName ? `${branding.companyName} - Confidential` : 'Confidential',
    ];
    const escaped = lines.map((line) => line.replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1'));
    const content = `BT /F1 10 Tf 40 760 Td 14 TL ${escaped.map((line, index) => `${index ? 'T* ' : ''}(${line.slice(0, 110)}) Tj`).join(' ')} ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'binary');
  }

  private exportValue(value: any) {
    let output = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@]/.test(output)) output = `'${output}`;
    return output;
  }

  private xmlEscape(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character);
  }

  async getFinancialReport(tenantDb: any, startDate?: string, endDate?: string) {
    if (!tenantDb) return { income: 0, expense: 0, netProfit: 0, transactions: [] };

    const where: any = { status: 'CLEARED', deletedAt: null };
    if (startDate || endDate) {
      where.date = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(`${endDate}T23:59:59.999`) } : {}),
      };
    }

    const txns = await tenantDb.transaction.findMany({
      where,
      include: { category: true, project: true, property: true, deal: true },
      orderBy: { date: 'desc' },
    });

    let income = 0;
    let expense = 0;

    for (const t of txns) {
      if (t.type === 'INCOME') income += Number(t.amount);
      else if (t.type === 'EXPENSE') expense += Number(t.amount);
    }

    return {
      income,
      expense,
      netProfit: income - expense,
      totalCount: txns.length,
      transactions: txns,
    };
  }

  async getConstructionReport(tenantDb: any) {
    if (!tenantDb) return { projects: [], totalBudget: 0 };

    const projects = await tenantDb.project.findMany({
      include: {
        tasks: true,
        dailyExpenses: true,
      },
    });

    let totalBudget = 0;
    for (const p of projects) {
      totalBudget += Number(p.budget);
    }

    return {
      totalProjects: projects.length,
      totalBudget,
      projects,
    };
  }

  getRegistry() {
    return REPORTS;
  }

  async runReport(
    db: any,
    reportId: string,
    query: { startDate?: string; endDate?: string; entityId?: string; projectId?: string },
  ) {
    const report = REPORTS.find((item) => item.id === reportId);
    if (!report) throw new NotFoundException('Report not found');
    const date = query.startDate || query.endDate
      ? {
          gte: query.startDate ? new Date(query.startDate) : undefined,
          // A date input is inclusive: do not discard the rest of its final day.
          lte: query.endDate ? new Date(`${query.endDate}T23:59:59.999`) : undefined,
        }
      : undefined;
    const projectId = query.projectId || (reportId.startsWith('construction-') ? query.entityId : undefined);
    const transactionProjectWhere = projectId ? { projectId } : {};
    let rows: any[] = [];
    let summary: Record<string, number> = {};

    if (['core-income', 'core-expense', 'core-transaction-detail'].includes(reportId)) {
      const type = reportId === 'core-income' ? 'INCOME' : reportId === 'core-expense' ? 'EXPENSE' : undefined;
      const transactions = await db.transaction.findMany({
        where: { deletedAt: null, status: 'CLEARED', ...(type ? { type } : {}), ...transactionProjectWhere, ...(date ? { date } : {}) },
        include: { category: true, project: true, property: true, deal: true, user: { select: { name: true, email: true } } },
        orderBy: { date: reportId === 'core-transaction-detail' ? 'asc' : 'desc' },
      });
      let income = 0;
      let expense = 0;
      let balance = 0;
      rows = transactions.map((transaction: any) => {
        const amount = Number(transaction.amount);
        if (transaction.type === 'INCOME') {
          income += amount;
          balance += amount;
        } else {
          expense += amount;
          balance -= amount;
        }
        return {
          reference: transaction.referenceId,
          transactionId: transaction.id,
          date: transaction.date,
          type: transaction.type,
          status: transaction.status,
          project: transaction.project?.name || 'General',
          property: transaction.property?.title || '—',
          category: transaction.category?.name || 'Uncategorized',
          description: transaction.description,
          notes: transaction.notes || '—',
          debit: transaction.type === 'EXPENSE' ? amount : 0,
          credit: transaction.type === 'INCOME' ? amount : 0,
          runningBalance: balance,
          recordedBy: transaction.user?.name || transaction.user?.email || 'System',
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
        };
      });
      summary = { rowCount: rows.length, income, expense, netProfit: income - expense };
    } else if (reportId === 'core-profit-summary') {
      const transactions = await db.transaction.findMany({ where: { deletedAt: null, status: 'CLEARED', ...transactionProjectWhere, ...(date ? { date } : {}) } });
      const income = transactions.filter((row: any) => row.type === 'INCOME').reduce((sum: number, row: any) => sum + Number(row.amount), 0);
      const expense = transactions.filter((row: any) => row.type === 'EXPENSE').reduce((sum: number, row: any) => sum + Number(row.amount), 0);
      rows = [{ income, expense, netProfit: income - expense, margin: income ? ((income - expense) / income) * 100 : 0 }];
      summary = { rowCount: rows.length, income, expense, netProfit: income - expense };
    } else if (reportId === 'construction-project-profit') {
      const projects = await db.project.findMany({ where: { deletedAt: null, ...(projectId ? { id: projectId } : {}) } });
      const transactions = await db.transaction.findMany({ where: { deletedAt: null, status: 'CLEARED', projectId: { in: projects.map((row: any) => row.id) }, ...(date ? { date } : {}) } });
      rows = projects.map((project: any) => {
        const linked = transactions.filter((row: any) => row.projectId === project.id && this.constructionTransactionCategory(row));
        const income = linked.filter((row: any) => row.type === 'INCOME').reduce((sum: number, row: any) => sum + Number(row.amount), 0);
        const expenses = linked.filter((row: any) => row.type === 'EXPENSE').reduce((sum: number, row: any) => sum + Number(row.amount), 0);
        return { projectId: project.id, project: project.name, budget: project.budget, income, expenses, profit: income - expenses };
      });
      summary = {
        rowCount: rows.length,
        income: rows.reduce((sum, row) => sum + Number(row.income), 0),
        expense: rows.reduce((sum, row) => sum + Number(row.expenses), 0),
        netProfit: rows.reduce((sum, row) => sum + Number(row.profit), 0),
      };
    } else if (reportId === 'construction-material-usage') {
      rows = await db.constructionInventoryTransaction.findMany({
        where: { type: 'USAGE', deletedAt: null, ...(projectId ? { projectId } : {}), ...(date ? { date } : {}) },
        include: { material: true, project: true, user: { select: { id: true, name: true, email: true } } },
      });
    } else if (['construction-manpower-cost', 'construction-manpower-expenses'].includes(reportId)) {
      rows = await db.workerLedgerEntry.findMany({
        where: { ...(projectId ? { projectId } : {}), ...(date ? { date } : {}) },
        include: { staff: true, project: true, user: { select: { id: true, name: true, email: true } } },
      });
    } else if (reportId === 'construction-expenses') {
      rows = await db.dailyOperationalExpense.findMany({
        where: { deletedAt: null, ...(projectId ? { projectId } : {}), ...(date ? { date } : {}) },
        include: { staff: true, project: true, recordedBy: { select: { id: true, name: true, email: true } } },
      });
    } else if (reportId === 'construction-progress') {
      rows = (await db.project.findMany({ where: { deletedAt: null, ...(projectId ? { id: projectId } : {}) }, include: { tasks: { where: { deletedAt: null } } } }))
        .map((project: any) => ({ ...project, progress: projectProgress(project.tasks) }));
    } else if (reportId === 'construction-workforce-budget') {
      rows = await db.workforceContract.findMany({ where: { deletedAt: null, ...(projectId ? { projectId } : {}), ...(date ? { createdAt: date } : {}) }, include: { project: true, payments: true, budgetAdjustments: true } });
    } else if (reportId === 'real-estate-rental-income') {
      rows = await db.rentPayment.findMany({ where: { deletedAt: null, ...(query.entityId ? { contract: { is: { propertyId: query.entityId } } } : {}), ...(date ? { dueDate: date } : {}) }, include: { tenant: true, contract: { include: { property: true } } } });
    } else if (reportId === 'real-estate-occupancy') {
      rows = await db.property.findMany({ where: { deletedAt: null, ...(query.entityId ? { id: query.entityId } : {}) } });
    } else if (reportId === 'real-estate-property-sales') {
      rows = await db.deal.findMany({ where: { deletedAt: null, type: 'SALE', ...(query.entityId ? { propertyId: query.entityId } : {}), ...(date ? { createdAt: date } : {}) }, include: { property: true, client: true } });
    } else if (reportId === 'real-estate-due-payments') {
      rows = await db.deal.findMany({ where: { deletedAt: null, ...(query.entityId ? { propertyId: query.entityId } : {}), paymentStatus: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } }, include: { property: true, client: true } });
    } else if (reportId === 'real-estate-sales-performance') {
      rows = await db.deal.findMany({ where: { deletedAt: null, ...(query.entityId ? { propertyId: query.entityId } : {}), ...(date ? { createdAt: date } : {}) }, include: { property: true, client: true, createdBy: true } });
    } else if (reportId === 'material-stock-movement') {
      rows = await db.inventoryTransaction.findMany({ where: { ...(query.entityId ? { materialId: query.entityId } : {}), ...transactionProjectWhere, ...(date ? { date } : {}) }, include: { material: true, project: true, user: true } });
    } else if (reportId === 'material-purchases') {
      rows = await db.purchaseOrder.findMany({ where: { deletedAt: null, ...(date ? { createdAt: date } : {}) }, include: { supplier: true, items: { include: { material: true } } } });
    } else if (reportId === 'material-supplier-balances') {
      rows = await db.supplier.findMany({ where: { deletedAt: null }, include: { transactions: true } });
    } else if (reportId === 'material-sales') {
      rows = await db.materialSale.findMany({ where: { deletedAt: null, ...(date ? { date } : {}) }, include: { customer: true, items: { include: { material: true } } } });
    } else if (reportId === 'material-estimated-profit') {
      const materials = await db.material.findMany({ where: { deletedAt: null } });
      rows = materials.map((row: any) => ({ ...row, stockValue: Number(row.quantity) * Number(row.unitCost), estimatedRevenue: Number(row.quantity) * Number(row.salePrice), estimatedProfit: Number(row.quantity) * (Number(row.salePrice) - Number(row.unitCost)) }));
    } else if (reportId === 'payroll-summary') {
      rows = await db.payroll.findMany({ where: { deletedAt: null, ...(date ? { createdAt: date } : {}) }, include: { items: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    } else if (reportId === 'payroll-payslips') {
      rows = await db.payrollItem.findMany({ where: { payroll: { deletedAt: null, ...(date ? { createdAt: date } : {}) } }, include: { payroll: true, staff: true }, orderBy: { createdAt: 'desc' } });
    } else if (reportId === 'payroll-department-cost') {
      const items = await db.payrollItem.findMany({ where: { payroll: { deletedAt: null, ...(date ? { createdAt: date } : {}) } } });
      const totals = new Map<string, { department: string; employees: number; grossSalary: number; deductions: number; netSalary: number }>();
      for (const item of items) {
        const key = item.employeeDepartment;
        const row = totals.get(key) || { department: key, employees: 0, grossSalary: 0, deductions: 0, netSalary: 0 };
        row.employees += 1; row.grossSalary += Number(item.grossSalary); row.deductions += Number(item.deductions) + Number(item.tax); row.netSalary += Number(item.netSalary);
        totals.set(key, row);
      }
      rows = Array.from(totals.values());
    }

    return {
      report,
      generatedAt: new Date(),
      summary: { rowCount: rows.length, ...summary },
      rows,
    };
  }

  listSchedules(db: any) {
    return db.reportSchedule.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  createSchedule(db: any, data: ReportScheduleDto) {
    if (!REPORTS.some((item) => item.id === data.reportId)) throw new NotFoundException('Report not found');
    return db.reportSchedule.create({ data: { ...data, frequency: data.frequency as any } });
  }

  async updateSchedule(db: any, id: string, data: ReportScheduleDto) {
    const result = await db.reportSchedule.updateMany({
      where: { id, deletedAt: null },
      data: { ...data, frequency: data.frequency as any },
    });
    if (!result.count) throw new NotFoundException('Report schedule not found');
    return db.reportSchedule.findUnique({ where: { id } });
  }

  async deleteSchedule(db: any, id: string) {
    const result = await db.reportSchedule.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
    if (!result.count) throw new NotFoundException('Report schedule not found');
    return { deleted: true };
  }

  private dateFilter(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return undefined;
    return {
      gte: startDate ? new Date(startDate) : undefined,
      lte: endDate ? new Date(`${endDate}T23:59:59.999`) : undefined,
    };
  }

  private staffName(staff?: { firstName?: string; lastName?: string } | null) {
    if (!staff) return null;
    return [staff.firstName, staff.lastName].filter(Boolean).join(' ').trim() || null;
  }

  private assertCategory(category: string): 'manpower' | 'materials' | 'expenses' {
    if (category === 'manpower' || category === 'materials' || category === 'expenses') return category;
    throw new NotFoundException('Unknown report category');
  }

  private async getProjectOrThrow(db: any, projectId: string) {
    const project = await db.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: { assignedStaff: { where: { deletedAt: null }, take: 5 }, tasks: { where: { deletedAt: null }, select: { status: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    return { ...project, progress: projectProgress(project.tasks) };
  }

  private materialLineTotal(row: any) {
    return Number(row.quantity) * Number(row.material?.unitCost || 0);
  }

  private constructionTransactionCategory(row: any): 'income' | 'manpower' | 'materials' | 'expenses' | null {
    const reference = String(row.referenceId || '').toLowerCase();
    if (reference.startsWith('purchase:') || reference.startsWith('sale:') || reference.startsWith('transport:')) {
      return null;
    }
    if (row.type === 'INCOME') return 'income';
    if (reference.startsWith('construction-procurement:')) return 'materials';
    if (reference.startsWith('expense:')) {
      return constructionExpenseCategory(row.category?.code || row.category?.name).section;
    }
    if (['wfpayment:', 'ledger:', 'payroll-', 'subpayment:'].some((prefix) => reference.startsWith(prefix))) {
      return 'manpower';
    }
    return null;
  }

  private constructionRollupLabel(row: any, category: 'manpower' | 'materials' | 'expenses') {
    if (category === 'materials') return String(row.description || 'Construction Materials').replace(/ purchase(?:\s.*)?$/i, '').trim();
    if (category === 'manpower' && String(row.referenceId || '').toLowerCase().startsWith('payroll-')) return 'Monthly Payroll';
    return row.category?.name || (category === 'manpower' ? 'Labor' : 'Site Expenses');
  }

  async listProjectReports(db: any) {
    const projects = await db.project.findMany({
      where: { deletedAt: null },
      include: {
        assignedStaff: { where: { deletedAt: null }, take: 3, orderBy: { firstName: 'asc' } },
        tasks: { where: { deletedAt: null }, select: { status: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const projectIds = projects.map((p: any) => p.id);
    if (!projectIds.length) return [];

    const transactions = await db.transaction.findMany({
      where: { deletedAt: null, status: 'CLEARED', type: 'EXPENSE', projectId: { in: projectIds } },
      select: { projectId: true, referenceId: true, type: true, amount: true, category: { select: { name: true, code: true } } },
    });

    const spentByProject = new Map<string, number>();
    for (const row of transactions) {
      if (!row.projectId || !this.constructionTransactionCategory(row)) continue;
      spentByProject.set(row.projectId, (spentByProject.get(row.projectId) || 0) + Number(row.amount));
    }

    return projects.map((project: any) => {
      const budget = Number(project.budget || 0);
      const spentToDate = spentByProject.get(project.id) || 0;
      const manager = project.assignedStaff?.[0]
        ? this.staffName(project.assignedStaff[0])
        : null;
      return {
        id: project.id,
        name: project.name,
        location: project.location,
        status: project.status,
        budget,
        spentToDate,
        budgetUsedPct: budget > 0 ? Math.round((spentToDate / budget) * 100) : 0,
        progress: projectProgress(project.tasks),
        startDate: project.startDate,
        manager,
        assignees: (project.assignedStaff || []).map((s: any) => this.staffName(s)).filter(Boolean),
      };
    });
  }

  async getProjectOverview(db: any, projectId: string, query: { startDate?: string; endDate?: string } = {}) {
    const project = await this.getProjectOrThrow(db, projectId);
    const date = this.dateFilter(query.startDate, query.endDate);

    const transactions = await db.transaction.findMany({
      where: { deletedAt: null, status: 'CLEARED', projectId, ...(date ? { date } : {}) },
      include: { category: { select: { name: true, code: true } }, user: { select: { id: true, name: true, email: true } } },
      orderBy: { date: 'asc' },
    });
    const scoped = transactions
      .map((row: any) => ({ ...row, constructionCategory: this.constructionTransactionCategory(row) }))
      .filter((row: any) => row.constructionCategory);
    const incomeTxns = scoped.filter((row: any) => row.constructionCategory === 'income');

    const incomeAmount = incomeTxns.reduce((sum: number, row: any) => sum + Number(row.amount), 0);

    const buildLines = (category: 'manpower' | 'materials' | 'expenses', code: string) => {
      const totals = new Map<string, number>();
      for (const row of scoped.filter((item: any) => item.constructionCategory === category)) {
        const label = this.constructionRollupLabel(row, category);
        totals.set(label, (totals.get(label) || 0) + Number(row.amount));
      }
      return Array.from(totals.entries())
        .map(([label, amount]) => ({ code, label, amount, filterKey: label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    };
    const manpowerLines = buildLines('manpower', '50100');
    const materialLines = buildLines('materials', '50200');
    const expenseLines = buildLines('expenses', '50300');
    const manpowerTotal = manpowerLines.reduce((sum, row) => sum + row.amount, 0);
    const materialsTotal = materialLines.reduce((sum, row) => sum + row.amount, 0);
    const expensesTotal = expenseLines.reduce((sum, row) => sum + row.amount, 0);

    const totalExpense = manpowerTotal + materialsTotal + expensesTotal;
    const allDates = [
      ...incomeTxns.map((r: any) => r.date),
      ...scoped.filter((row: any) => row.constructionCategory !== 'income').map((row: any) => row.date),
    ].filter(Boolean).map((d: Date) => new Date(d).getTime());

    const manager = project.assignedStaff?.[0] ? this.staffName(project.assignedStaff[0]) : null;

    return {
      project: {
        id: project.id,
        name: project.name,
        location: project.location,
        status: project.status,
        budget: Number(project.budget || 0),
        progress: project.progress || 0,
        startDate: project.startDate,
        manager,
      },
      period: allDates.length
        ? { from: new Date(Math.min(...allDates)).toISOString(), to: new Date(Math.max(...allDates)).toISOString() }
        : { from: null, to: null },
      income: { code: '40100', label: 'Construction Income', amount: incomeAmount },
      sections: [
        { code: '50100', category: 'manpower', label: 'Manpower', lines: manpowerLines, total: manpowerTotal },
        { code: '50200', category: 'materials', label: 'Materials', lines: materialLines, total: materialsTotal },
        { code: '50300', category: 'expenses', label: 'Site Expenses', lines: expenseLines, total: expensesTotal },
      ],
      totalExpense,
      netIncome: incomeAmount - totalExpense,
      generatedAt: new Date().toISOString(),
    };
  }

  async getProjectCategoryLedger(
    db: any,
    projectId: string,
    category: string,
    query: { startDate?: string; endDate?: string; filter?: string } = {},
  ) {
    const cat = this.assertCategory(category);
    const project = await this.getProjectOrThrow(db, projectId);
    const date = this.dateFilter(query.startDate, query.endDate);
    const filter = query.filter?.trim() || undefined;

    const rows = await db.transaction.findMany({
      where: { deletedAt: null, status: 'CLEARED', type: 'EXPENSE', projectId, ...(date ? { date } : {}) },
      include: { category: { select: { name: true, code: true } }, user: { select: { id: true, name: true, email: true } } },
      orderBy: { date: 'desc' },
    });
    const mapped = rows
      .filter((row: any) => this.constructionTransactionCategory(row) === cat)
      .map((row: any) => {
        const rollupKey = this.constructionRollupLabel(row, cat);
        const enteredBy = row.user?.name || row.user?.email || 'System';
        return {
          id: row.id,
          category: cat,
          date: row.date,
          amount: Number(row.amount),
          description: row.description,
          rollupKey,
          item: cat === 'materials' ? rollupKey : undefined,
          worker: cat === 'manpower' ? row.description : undefined,
          expenseCategory: row.category?.name || rollupKey,
          status: row.status,
          type: row.type,
          enteredBy,
          usedBy: enteredBy,
          recordedBy: enteredBy,
          userId: row.userId,
          notes: row.notes,
        };
      })
      .filter((row: any) => !filter || row.rollupKey === filter);
    return {
      project: { id: project.id, name: project.name },
      category: cat,
      label: cat === 'manpower' ? 'Manpower' : cat === 'materials' ? 'Materials' : 'Site Expenses',
      filter: filter || null,
      filterLabel: filter || null,
      total: mapped.reduce((s: number, r: any) => s + r.amount, 0),
      rows: mapped,
    };
  }

  async getProjectCategoryDetail(db: any, projectId: string, category: string, txnId: string) {
    const ledger = await this.getProjectCategoryLedger(db, projectId, category);
    const row = ledger.rows.find((item: any) => item.id === txnId);
    if (!row) throw new NotFoundException('Transaction not found');
    const project = await this.getProjectOrThrow(db, projectId);
    return {
      project: {
        id: project.id,
        name: project.name,
        location: project.location,
        status: project.status,
        manager: project.assignedStaff?.[0] ? this.staffName(project.assignedStaff[0]) : null,
      },
      category: ledger.category,
      label: ledger.label,
      transaction: row,
      generatedAt: new Date().toISOString(),
    };
  }

  /* ─── Real estate property reports ─── */

  async listPropertyReports(db: any) {
    const properties = await db.property.findMany({
      where: { deletedAt: null },
      include: {
        rentalContracts: { where: { deletedAt: null }, take: 3 },
        tenants: { where: { deletedAt: null }, take: 3 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return properties.map((p: any) => ({
      id: p.id,
      name: p.title,
      location: p.address,
      status: p.status,
      type: p.type,
      budget: Number(p.price || 0),
      spentToDate: 0,
      budgetUsedPct: 0,
      progress: p.status === 'SOLD' || p.status === 'RENTED' ? 100 : p.status === 'AVAILABLE' ? 0 : 50,
      startDate: p.createdAt,
      manager: p.tenants?.[0]?.name || null,
      assignees: (p.tenants || []).map((t: any) => t.name).filter(Boolean),
      meta: p.type,
    }));
  }

  private async getPropertyOrThrow(db: any, propertyId: string) {
    const property = await db.property.findFirst({ where: { id: propertyId, deletedAt: null } });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async getPropertyOverview(db: any, propertyId: string, query: { startDate?: string; endDate?: string } = {}) {
    const property = await this.getPropertyOrThrow(db, propertyId);
    const date = this.dateFilter(query.startDate, query.endDate);

    const [deals, payments, contracts] = await Promise.all([
      db.deal.findMany({
        where: { deletedAt: null, propertyId, ...(date ? { createdAt: date } : {}) },
        include: { client: { select: { name: true } } },
      }),
      db.rentPayment.findMany({
        where: {
          deletedAt: null,
          ...(date ? { dueDate: date } : {}),
          contract: { is: { propertyId } },
        },
        include: { tenant: { select: { name: true } }, contract: { select: { propertyId: true, monthlyRent: true } } },
      }),
      db.rentalContract.findMany({
        where: { deletedAt: null, propertyId },
        include: { tenant: { select: { name: true } } },
      }),
    ]);

    const salesDeals = deals.filter((d: any) => d.type === 'SALE');
    const salesCollected = salesDeals.reduce((s: number, d: any) => s + Number(d.paidAmount || 0), 0);
    const salesContracted = salesDeals.reduce((s: number, d: any) => s + Number(d.totalAmount || 0), 0);
    const rentalPaid = payments.reduce((s: number, p: any) => s + Number(p.amountPaid || 0), 0);
    const incomeAmount = salesCollected + rentalPaid;

    const salesLines = salesDeals.map((d: any) => ({
      code: '40200',
      label: d.client?.name || 'Sale',
      amount: Number(d.paidAmount || 0),
      filterKey: d.paymentStatus || d.id,
    }));
    const rentalRollup = new Map<string, number>();
    for (const p of payments) {
      const key = p.status || 'UNPAID';
      rentalRollup.set(key, (rentalRollup.get(key) || 0) + Number(p.amountPaid || 0));
    }
    const rentalSectionLines = Array.from(rentalRollup.entries()).map(([label, amount]) => ({
      code: '40100', label, amount, filterKey: label,
    }));

    const contractLines = contracts.map((c: any) => ({
      code: '40300',
      label: c.tenant?.name || 'Contract',
      amount: Number(c.monthlyRent || 0),
      filterKey: c.status || 'ACTIVE',
    }));

    const allDates = [
      ...deals.map((d: any) => d.createdAt),
      ...payments.map((p: any) => p.dueDate),
    ].filter(Boolean).map((d: Date) => new Date(d).getTime());

    return {
      project: {
        id: property.id,
        name: property.title,
        location: property.address,
        status: property.status,
        budget: Number(property.price || 0),
        progress: 0,
        startDate: property.createdAt,
        manager: null,
        type: property.type,
      },
      period: allDates.length
        ? { from: new Date(Math.min(...allDates)).toISOString(), to: new Date(Math.max(...allDates)).toISOString() }
        : { from: null, to: null },
      income: { code: '40000', label: 'Collected income', amount: incomeAmount },
      sections: [
        { code: '40100', category: 'rentals', label: 'Rent Collected', lines: rentalSectionLines, total: rentalPaid },
        { code: '40200', category: 'sales', label: 'Sales Collected', lines: salesLines, total: salesCollected },
        { code: '40300', category: 'contracts', label: 'Active Leases (monthly)', lines: contractLines, total: contractLines.reduce((s, l) => s + l.amount, 0) },
      ],
      totalExpense: 0,
      netIncome: incomeAmount,
      extras: { salesContracted },
      generatedAt: new Date().toISOString(),
    };
  }

  async getPropertyCategoryLedger(db: any, propertyId: string, category: string, query: { startDate?: string; endDate?: string; filter?: string } = {}) {
    await this.getPropertyOrThrow(db, propertyId);
    const date = this.dateFilter(query.startDate, query.endDate);
    const filter = query.filter?.trim() || undefined;
    const property = await this.getPropertyOrThrow(db, propertyId);

    if (category === 'rentals' || category === 'payments') {
      const rows = await db.rentPayment.findMany({
        where: {
          deletedAt: null,
          ...(date ? { dueDate: date } : {}),
          ...(filter ? { status: filter } : {}),
          contract: { is: { propertyId } },
        },
        include: {
          tenant: { select: { name: true, phone: true } },
          contract: { select: { monthlyRent: true, status: true } },
        },
        orderBy: { dueDate: 'desc' },
      });
      const mapped = rows.map((row: any) => ({
        id: row.id,
        category: 'rentals',
        date: row.dueDate,
        amount: Number(row.amountPaid || 0),
        description: row.notes || `Rent · ${row.status}`,
        worker: row.tenant?.name || '—',
        role: row.status,
        expenseCategory: row.status,
        rollupKey: row.status,
        enteredBy: '—',
        recordedBy: '—',
        status: row.status,
        paidDate: row.paidDate,
        amountDue: Number(row.amountDue || 0),
        amountPaid: Number(row.amountPaid || 0),
        receiptNo: row.receiptNo,
      }));
      return {
        project: { id: property.id, name: property.title },
        category: 'rentals',
        label: 'Rent Payments',
        filter: filter || null,
        filterLabel: filter || null,
        total: mapped.reduce((s: number, r: any) => s + r.amount, 0),
        rows: mapped,
      };
    }

    if (category === 'sales') {
      const rows = await db.deal.findMany({
        where: {
          deletedAt: null,
          propertyId,
          type: 'SALE',
          ...(date ? { createdAt: date } : {}),
          ...(filter ? { paymentStatus: filter } : {}),
        },
        include: {
          client: { select: { name: true, phone: true, email: true } },
          createdBy: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const mapped = rows.map((row: any) => ({
        id: row.id,
        category: 'sales',
        date: row.closedAt || row.createdAt,
        amount: Number(row.paidAmount || 0),
        description: row.notes || 'Property sale',
        worker: row.client?.name || '—',
        role: row.paymentStatus,
        expenseCategory: row.paymentStatus,
        enteredBy: row.createdBy?.name || row.createdBy?.email || '—',
        status: row.paymentStatus,
        paidAmount: Number(row.paidAmount || 0),
        totalAmount: Number(row.totalAmount || 0),
      }));
      return {
        project: { id: property.id, name: property.title },
        category: 'sales',
        label: 'Property Sales',
        filter: filter || null,
        filterLabel: filter || null,
        total: mapped.reduce((s: number, r: any) => s + r.amount, 0),
        rows: mapped,
      };
    }

    if (category === 'contracts') {
      const rows = await db.rentalContract.findMany({
        where: {
          deletedAt: null,
          propertyId,
          ...(filter ? { status: filter } : {}),
        },
        include: { tenant: { select: { name: true, phone: true } } },
        orderBy: { startDate: 'desc' },
      });
      const mapped = rows.map((row: any) => ({
        id: row.id,
        category: 'contracts',
        date: row.startDate,
        amount: Number(row.monthlyRent || 0),
        description: row.notes || 'Lease contract',
        worker: row.tenant?.name || '—',
        role: row.status,
        expenseCategory: row.status,
        enteredBy: '—',
        status: row.status,
        endDate: row.endDate,
      }));
      return {
        project: { id: property.id, name: property.title },
        category: 'contracts',
        label: 'Lease Contracts',
        filter: filter || null,
        filterLabel: filter || null,
        total: mapped.reduce((s: number, r: any) => s + r.amount, 0),
        rows: mapped,
      };
    }

    throw new NotFoundException('Unknown report category');
  }

  async getPropertyCategoryDetail(db: any, propertyId: string, category: string, txnId: string) {
    const ledger = await this.getPropertyCategoryLedger(db, propertyId, category);
    const row = ledger.rows.find((item: any) => item.id === txnId);
    if (!row) throw new NotFoundException('Transaction not found');
    const property = await this.getPropertyOrThrow(db, propertyId);
    return {
      project: { id: property.id, name: property.title, location: property.address, status: property.status, manager: null },
      category: ledger.category,
      label: ledger.label,
      transaction: row,
      generatedAt: new Date().toISOString(),
    };
  }

  /* ─── Materials product reports ─── */

  async listMaterialReports(db: any) {
    const materials = await db.material.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return materials.map((m: any) => {
      const qty = Number(m.quantity || 0);
      const unitCost = Number(m.unitCost || 0);
      const stockValue = qty * unitCost;
      return {
        id: m.id,
        name: m.name,
        location: m.warehouse || m.category || 'Warehouse',
        status: m.status,
        type: m.unit,
        budget: stockValue,
        spentToDate: stockValue,
        budgetUsedPct: qty <= Number(m.lowStockThreshold || 0) ? 100 : Math.min(100, Math.round((qty / Math.max(qty, 1)) * 100)),
        progress: Math.min(100, Math.round(qty)),
        startDate: m.createdAt,
        manager: `${qty} ${m.unit || 'units'}`,
        assignees: [],
        meta: m.materialType || m.category,
      };
    });
  }

  private async getMaterialOrThrow(db: any, materialId: string) {
    const material = await db.material.findFirst({ where: { id: materialId, deletedAt: null } });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  async getMaterialOverview(db: any, materialId: string, query: { startDate?: string; endDate?: string } = {}) {
    const material = await this.getMaterialOrThrow(db, materialId);
    const date = this.dateFilter(query.startDate, query.endDate);
    const qty = Number(material.quantity || 0);
    const unitCost = Number(material.unitCost || 0);
    const salePrice = Number(material.salePrice || 0);
    const stockValue = qty * unitCost;

    const [movements, purchaseItems, saleItems] = await Promise.all([
      db.inventoryTransaction.findMany({
        where: { materialId, deletedAt: null, ...(date ? { date } : {}) },
        include: { user: { select: { name: true, email: true } }, project: { select: { name: true } } },
        orderBy: { date: 'desc' },
      }),
      db.purchaseOrderItem.findMany({
        where: {
          materialId,
          purchaseOrder: { deletedAt: null, status: 'RECEIVED', ...(date ? { receivedAt: date } : {}) },
        },
        include: {
          purchaseOrder: { include: { supplier: { select: { name: true } } } },
        },
      }),
      db.materialSaleItem.findMany({
        where: {
          materialId,
          sale: { deletedAt: null, ...(date ? { date } : {}) },
        },
        include: {
          sale: { include: { customer: { select: { name: true } }, user: { select: { name: true, email: true } } } },
        },
      }),
    ]);

    const movementRollup = new Map<string, number>();
    for (const row of movements) {
      const key = row.type || 'MOVEMENT';
      const line = Number(row.quantity) * unitCost;
      movementRollup.set(key, (movementRollup.get(key) || 0) + line);
    }
    const movementLines = Array.from(movementRollup.entries()).map(([label, amount]) => ({
      code: '50100', label, amount, filterKey: label,
    }));
    const movementTotal = movementLines.reduce((s, l) => s + l.amount, 0);

    const purchaseTotal = purchaseItems.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitCost), 0);
    const purchaseLines = purchaseItems.slice(0, 12).map((i: any) => ({
      code: '50200',
      label: i.purchaseOrder?.supplier?.name || i.purchaseOrder?.orderNo || 'Purchase',
      amount: Number(i.quantity) * Number(i.unitCost),
      filterKey: i.purchaseOrder?.status || 'ORDERED',
    }));

    const salesTotal = saleItems.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitPrice), 0);
    const salesLines = saleItems.slice(0, 12).map((i: any) => ({
      code: '50300',
      label: i.sale?.customer?.name || i.sale?.invoiceNo || 'Sale',
      amount: Number(i.quantity) * Number(i.unitPrice),
      filterKey: i.sale?.invoiceNo || i.saleId,
    }));

    const allDates = [
      ...movements.map((r: any) => r.date),
      ...purchaseItems.map((i: any) => i.purchaseOrder?.createdAt),
      ...saleItems.map((i: any) => i.sale?.date),
    ].filter(Boolean).map((d: Date) => new Date(d).getTime());

    return {
      project: {
        id: material.id,
        name: material.name,
        location: material.warehouse || material.category || null,
        status: material.status,
        budget: stockValue,
        progress: 0,
        startDate: material.createdAt,
        manager: `${qty} ${material.unit || ''}`.trim(),
      },
      period: allDates.length
        ? { from: new Date(Math.min(...allDates)).toISOString(), to: new Date(Math.max(...allDates)).toISOString() }
        : { from: null, to: null },
      income: { code: '40100', label: 'Sales revenue', amount: salesTotal },
      sections: [
        { code: '50100', category: 'movements', label: 'Stock Movements', lines: movementLines, total: movementTotal },
        { code: '50200', category: 'purchases', label: 'Purchases (received)', lines: purchaseLines, total: purchaseTotal },
        { code: '50300', category: 'sales', label: 'Sales', lines: salesLines, total: salesTotal },
      ],
      totalExpense: purchaseTotal,
      netIncome: salesTotal - purchaseTotal,
      generatedAt: new Date().toISOString(),
      extras: { quantity: qty, unitCost, salePrice, unit: material.unit, stockValue },
    };
  }

  async getMaterialCategoryLedger(db: any, materialId: string, category: string, query: { startDate?: string; endDate?: string; filter?: string } = {}) {
    const material = await this.getMaterialOrThrow(db, materialId);
    const date = this.dateFilter(query.startDate, query.endDate);
    const filter = query.filter?.trim() || undefined;
    const unitCost = Number(material.unitCost || 0);

    if (category === 'movements') {
      const rows = await db.inventoryTransaction.findMany({
        where: {
          materialId,
          deletedAt: null,
          ...(date ? { date } : {}),
          ...(filter ? { type: filter } : {}),
        },
        include: {
          user: { select: { name: true, email: true } },
          project: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
      });
      const mapped = rows.map((row: any) => ({
        id: row.id,
        category: 'movements',
        date: row.date,
        amount: Number(row.quantity) * unitCost,
        item: material.name,
        description: row.notes || row.type,
        worker: row.project?.name || '—',
        role: row.type,
        expenseCategory: row.type,
        rollupKey: row.type,
        quantity: Number(row.quantity),
        unit: material.unit,
        unitCost,
        enteredBy: row.user?.name || row.user?.email || '—',
        usedBy: row.user?.name || row.user?.email || '—',
        status: row.type,
        warehouse: row.warehouse || material.warehouse,
      }));
      return {
        project: { id: material.id, name: material.name },
        category: 'movements',
        label: 'Stock Movements',
        filter: filter || null,
        filterLabel: filter || null,
        total: mapped.reduce((s: number, r: any) => s + r.amount, 0),
        rows: mapped,
      };
    }

    if (category === 'purchases') {
      const rows = await db.purchaseOrderItem.findMany({
        where: {
          materialId,
          purchaseOrder: {
            deletedAt: null,
            status: 'RECEIVED',
            ...(date ? { receivedAt: date } : {}),
            ...(filter ? {
              OR: [
                { orderNo: { contains: filter, mode: 'insensitive' } },
                { supplier: { is: { name: { contains: filter, mode: 'insensitive' } } } },
              ],
            } : {}),
          },
        },
        include: {
          purchaseOrder: { include: { supplier: { select: { name: true } } } },
        },
        orderBy: { purchaseOrder: { receivedAt: 'desc' } },
      });
      const mapped = rows.map((row: any) => ({
        id: row.id,
        category: 'purchases',
        date: row.purchaseOrder?.receivedAt || row.purchaseOrder?.orderedAt || row.purchaseOrder?.createdAt,
        amount: Number(row.quantity) * Number(row.unitCost),
        item: material.name,
        description: row.purchaseOrder?.orderNo || 'Purchase order',
        worker: row.purchaseOrder?.supplier?.name || '—',
        role: row.purchaseOrder?.status || '—',
        expenseCategory: row.purchaseOrder?.status,
        quantity: Number(row.quantity),
        unitCost: Number(row.unitCost),
        enteredBy: '—',
        status: row.purchaseOrder?.status,
      }));
      return {
        project: { id: material.id, name: material.name },
        category: 'purchases',
        label: 'Purchases',
        filter: filter || null,
        filterLabel: filter || null,
        total: mapped.reduce((s: number, r: any) => s + r.amount, 0),
        rows: mapped,
      };
    }

    if (category === 'sales') {
      const rows = await db.materialSaleItem.findMany({
        where: {
          materialId,
          sale: { deletedAt: null, ...(date ? { date } : {}) },
        },
        include: {
          sale: { include: { customer: { select: { name: true } }, user: { select: { name: true, email: true } } } },
        },
        orderBy: { sale: { date: 'desc' } },
      });
      const mapped = rows
        .filter((row: any) => !filter || row.sale?.invoiceNo === filter)
        .map((row: any) => ({
          id: row.id,
          category: 'sales',
          date: row.sale?.date,
          amount: Number(row.quantity) * Number(row.unitPrice),
          item: material.name,
          description: row.sale?.invoiceNo || 'Sale',
          worker: row.sale?.customer?.name || '—',
          role: 'SALE',
          quantity: Number(row.quantity),
          unitCost: Number(row.unitPrice),
          enteredBy: row.sale?.user?.name || row.sale?.user?.email || '—',
          status: 'SOLD',
        }));
      return {
        project: { id: material.id, name: material.name },
        category: 'sales',
        label: 'Sales',
        filter: filter || null,
        filterLabel: filter || null,
        total: mapped.reduce((s: number, r: any) => s + r.amount, 0),
        rows: mapped,
      };
    }

    throw new NotFoundException('Unknown report category');
  }

  async getMaterialCategoryDetail(db: any, materialId: string, category: string, txnId: string) {
    const ledger = await this.getMaterialCategoryLedger(db, materialId, category);
    const row = ledger.rows.find((item: any) => item.id === txnId);
    if (!row) throw new NotFoundException('Transaction not found');
    const material = await this.getMaterialOrThrow(db, materialId);
    return {
      project: {
        id: material.id,
        name: material.name,
        location: material.warehouse || material.category,
        status: material.status,
        manager: null,
      },
      category: ledger.category,
      label: ledger.label,
      transaction: row,
      generatedAt: new Date().toISOString(),
    };
  }
}
