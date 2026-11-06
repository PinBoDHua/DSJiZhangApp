export interface PayslipOptions {
  showOvertime: boolean;
  showBonus: boolean;
  showDeduction: boolean;
  showOverRest: boolean;
  showAdvance: boolean;
  showRestDates: boolean;
  /** 文字版 PDF 末尾附工记明细，长周期会自动分页 */
  showEntryDetails: boolean;
  footerNote: string;
}

export const PAYSLIP_OPTIONS_KEY = 'xinshi.payslipOptions';

export const DEFAULT_PAYSLIP_OPTIONS: PayslipOptions = {
  showOvertime: true,
  showBonus: true,
  showDeduction: true,
  showOverRest: true,
  showAdvance: true,
  showRestDates: true,
  showEntryDetails: true,
  footerNote: '',
};

export type PayslipTemplateId = 'full' | 'simple' | 'amount' | 'custom';

export const PAYSLIP_TEMPLATES: Array<{
  id: Exclude<PayslipTemplateId, 'custom'>;
  label: string;
  options: PayslipOptions;
}> = [
  {
    id: 'full',
    label: '完整版',
    options: { ...DEFAULT_PAYSLIP_OPTIONS },
  },
  {
    id: 'simple',
    label: '简洁版',
    options: {
      ...DEFAULT_PAYSLIP_OPTIONS,
      showOverRest: false,
      showAdvance: false,
    },
  },
  {
    id: 'amount',
    label: '只发金额',
    options: {
      ...DEFAULT_PAYSLIP_OPTIONS,
      showOverRest: false,
      showAdvance: false,
      showRestDates: false,
      showEntryDetails: false,
      footerNote: '仅金额对账',
    },
  },
];

export function optionsForTemplate(
  templateId: Exclude<PayslipTemplateId, 'custom'>,
): PayslipOptions {
  return (
    PAYSLIP_TEMPLATES.find((item) => item.id === templateId)?.options ??
    DEFAULT_PAYSLIP_OPTIONS
  );
}

export function matchPayslipTemplate(options: PayslipOptions): PayslipTemplateId {
  const found = PAYSLIP_TEMPLATES.find(
    (item) =>
      item.options.showOvertime === options.showOvertime &&
      item.options.showBonus === options.showBonus &&
      item.options.showDeduction === options.showDeduction &&
      item.options.showOverRest === options.showOverRest &&
      item.options.showAdvance === options.showAdvance &&
      item.options.showRestDates === options.showRestDates &&
      item.options.showEntryDetails === options.showEntryDetails &&
      item.options.footerNote === options.footerNote,
  );
  return found?.id ?? 'custom';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizePayslipOptions(value: unknown): PayslipOptions {
  const raw = typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
  return {
    showOvertime: asBoolean(raw.showOvertime, DEFAULT_PAYSLIP_OPTIONS.showOvertime),
    showBonus: asBoolean(raw.showBonus, DEFAULT_PAYSLIP_OPTIONS.showBonus),
    showDeduction: asBoolean(raw.showDeduction, DEFAULT_PAYSLIP_OPTIONS.showDeduction),
    showOverRest: asBoolean(raw.showOverRest, DEFAULT_PAYSLIP_OPTIONS.showOverRest),
    showAdvance: asBoolean(raw.showAdvance, DEFAULT_PAYSLIP_OPTIONS.showAdvance),
    showRestDates: asBoolean(raw.showRestDates, DEFAULT_PAYSLIP_OPTIONS.showRestDates),
    showEntryDetails: asBoolean(
      raw.showEntryDetails,
      DEFAULT_PAYSLIP_OPTIONS.showEntryDetails,
    ),
    footerNote:
      typeof raw.footerNote === 'string' ? raw.footerNote.slice(0, 30) : '',
  };
}

export function loadPayslipOptions(): PayslipOptions {
  try {
    const raw = localStorage.getItem(PAYSLIP_OPTIONS_KEY);
    if (!raw) return DEFAULT_PAYSLIP_OPTIONS;
    return normalizePayslipOptions(JSON.parse(raw));
  } catch {
    return DEFAULT_PAYSLIP_OPTIONS;
  }
}

export function savePayslipOptions(options: PayslipOptions): void {
  try {
    localStorage.setItem(PAYSLIP_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // 本地偏好存不下不影响工资条生成。
  }
}
