import type { Settlement } from '../types';
import { formatDateTime } from './date';
import { formatMoney } from './money';
import { saveBlobFile } from './native';
import { buildPayslipRows } from './payslip';
import { DEFAULT_PAYSLIP_OPTIONS, type PayslipOptions } from './payslipOptions';
import { createSettlementQrFor } from './shareQr';
import { settlementChecksum } from './checksum';

const FONT_FILE = 'xinshi-sans.ttf';
let fontCache: string | null = null;

function binaryString(bytes: Uint8Array): string {
  let result = '';
  const chunk = 8192;
  for (let index = 0; index < bytes.length; index += chunk) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return result;
}

async function loadPdfFont(): Promise<string> {
  if (fontCache) return fontCache;
  const response = await fetch(`${import.meta.env.BASE_URL}fonts/xinshi-sans.ttf`);
  if (!response.ok) throw new Error('中文字体加载失败');
  fontCache = binaryString(new Uint8Array(await response.arrayBuffer()));
  return fontCache;
}

function pdfFileName(settlement: Settlement): string {
  const safeJob = settlement.jobName.replace(/[\\/:*?"<>|]/g, '').slice(0, 16);
  return `薪时文字工资条-${safeJob}-${settlement.periodEnd}.pdf`;
}

/** 文字版 PDF：金额与文字可选、可搜索，内嵌 Noto Sans SC 子集。 */
export async function downloadPayslipTextPdf(
  settlement: Settlement,
  options: PayslipOptions = DEFAULT_PAYSLIP_OPTIONS,
): Promise<'web' | 'native'> {
  const [{ jsPDF }, font] = await Promise.all([import('jspdf'), loadPdfFont()]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS(FONT_FILE, font);
  doc.addFont(FONT_FILE, 'XinshiSans', 'normal');
  doc.setFont('XinshiSans');

  const pageWidth = 210;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const isMonthly = settlement.payType === 'monthly';

  doc.setFillColor(20, 86, 61);
  doc.rect(0, 0, pageWidth, 36, 'F');
  doc.setTextColor(248, 242, 229);
  doc.setFontSize(18);
  doc.text('薪时 · 工资条', margin, 15);
  doc.setFontSize(8.5);
  doc.text('XINSHI · 每一小时都算数', margin, 21);
  doc.setFontSize(10);
  doc.text(settlement.jobName, margin, 29);
  doc.setFontSize(8.5);
  doc.text(
    `${settlement.periodStart.replace(/-/g, '.')} – ${settlement.periodEnd.replace(/-/g, '.')}`,
    pageWidth - margin,
    15,
    { align: 'right' },
  );
  doc.text('已结算', pageWidth - margin, 21, { align: 'right' });

  doc.setTextColor(111, 123, 114);
  doc.setFontSize(9);
  doc.text('应发净额', margin, 46);
  doc.setTextColor(23, 37, 31);
  doc.setFontSize(26);
  doc.text(formatMoney(settlement.net, { symbol: true }), margin, 57);

  doc.setFontSize(9);
  doc.setTextColor(52, 67, 58);
  const stats = isMonthly
    ? `出勤 ${settlement.days} 天 · 休息 ${settlement.restDays ?? 0} 天 · 工时 ${settlement.hours} 小时`
    : settlement.payType === 'piece'
      ? `数量 ${settlement.quantity ?? 0} ${settlement.unitLabel || '件'} · 工时 ${settlement.hours} 小时`
      : `出勤 ${settlement.days} 天 · 工时 ${settlement.hours} 小时 · 加班 ${settlement.otHours} 小时`;
  doc.text(stats, margin, 67);
  doc.setDrawColor(230, 224, 210);
  doc.line(margin, 72, pageWidth - margin, 72);

  const rows = buildPayslipRows(settlement, options);
  let y = 82;
  for (const row of rows) {
    doc.setTextColor(52, 67, 58);
    doc.setFontSize(10);
    doc.text(row.label, margin, y);
    doc.setTextColor(row.negative ? 179 : 23, row.negative ? 64 : 37, row.negative ? 47 : 31);
    doc.text(
      `${row.negative ? '−' : ''}${formatMoney(Math.abs(row.value), { symbol: true })}`,
      pageWidth - margin,
      y,
      { align: 'right' },
    );
    doc.setDrawColor(239, 234, 223);
    doc.line(margin, y + 4, pageWidth - margin, y + 4);
    y += 10;
  }

  doc.setTextColor(20, 86, 61);
  doc.setFontSize(11);
  doc.text('应发净额', margin, y + 4);
  doc.setFontSize(16);
  doc.text(formatMoney(settlement.net, { symbol: true }), pageWidth - margin, y + 4, {
    align: 'right',
  });
  y += 16;

  if (isMonthly && (settlement.restDates ?? []).length > 0 && options.showRestDates) {
    doc.setTextColor(111, 123, 114);
    doc.setFontSize(9);
    doc.text(
      `休息日：${(settlement.restDates ?? [])
        .map((date) => date.replace(/-/g, '.').slice(5))
        .join('、')}`,
      margin,
      y,
    );
    y += 7;
  }

  if (settlement.note) {
    doc.setTextColor(111, 123, 114);
    doc.setFontSize(9);
    const note = doc.splitTextToSize(`备注：${settlement.note}`, contentWidth - 38);
    doc.text(note, margin, y);
    y += note.length * 5 + 3;
  }

  const qr = createSettlementQrFor(settlement);
  doc.addImage(qr.dataUrl, 'GIF', pageWidth - margin - 30, Math.max(y, 235), 30, 30);
  doc.setTextColor(111, 123, 114);
  doc.setFontSize(8);
  doc.text(`校验码：${settlementChecksum(settlement)}`, margin, 250);
  doc.text('扫码核对结算摘要', pageWidth - margin, 268, { align: 'right' });
  doc.setDrawColor(230, 224, 210);
  doc.line(margin, 274, pageWidth - margin, 274);
  doc.setFontSize(8);
  doc.text(
    `结算于 ${formatDateTime(settlement.createdAt)} · ${options.footerNote.trim() || '个人记账参考'}`,
    pageWidth / 2,
    281,
    { align: 'center' },
  );
  doc.text('薪时 XINSHI · 每一小时，都算数。', pageWidth / 2, 287, { align: 'center' });

  return saveBlobFile(doc.output('blob'), pdfFileName(settlement));
}
