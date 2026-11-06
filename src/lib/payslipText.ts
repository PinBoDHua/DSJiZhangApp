import type { Entry, Settlement } from '../types';
import { formatDateTime } from './date';
import { formatHours, formatMoney } from './money';
import { saveBlobFile } from './native';
import { buildPayslipRows } from './payslip';
import { buildPayslipDetailRows, chunkPayslipRows } from './payslipDetail';
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

/** 文字版 PDF：金额与文字可选、可搜索；长周期自动分页并附工记明细。 */
export async function downloadPayslipTextPdf(
  settlement: Settlement,
  options: PayslipOptions = DEFAULT_PAYSLIP_OPTIONS,
  entries: Entry[] = [],
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

  const drawContinuationHeader = (title: string): number => {
    doc.setFillColor(20, 86, 61);
    doc.rect(0, 0, pageWidth, 18, 'F');
    doc.setTextColor(248, 242, 229);
    doc.setFontSize(10);
    doc.text(title, margin, 11);
    doc.setFontSize(8);
    doc.text(settlement.jobName, pageWidth - margin, 11, { align: 'right' });
    doc.setTextColor(52, 67, 58);
    return 30;
  };

  let contentLimit = 232;
  const drawWrapped = (text: string, lineHeight = 5): void => {
    doc.setTextColor(111, 123, 114);
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    if (y + lines.length * lineHeight + 3 > contentLimit) {
      doc.addPage();
      contentLimit = 270;
      y = drawContinuationHeader('工资条（续）');
    }
    for (const line of lines) {
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += 2;
  };

  if (isMonthly && (settlement.restDates ?? []).length > 0 && options.showRestDates) {
    drawWrapped(
      `休息日：${(settlement.restDates ?? [])
        .map((date) => date.replace(/-/g, '.').slice(5))
        .join('、')}`,
    );
  }

  if (settlement.note) {
    drawWrapped(`备注：${settlement.note}`);
  }

  // 二维码与页脚固定在结算摘要第一页
  doc.setPage(1);
  const qr = createSettlementQrFor(settlement);
  doc.addImage(qr.dataUrl, 'GIF', pageWidth - margin - 30, 235, 30, 30);
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

  if (options.showEntryDetails) {
    const detailRows = buildPayslipDetailRows(settlement, entries);
    if (detailRows.length > 0) {
      const detailPages = chunkPayslipRows(detailRows);
      detailPages.forEach((pageRows, index) => {
        doc.addPage();
        drawContinuationHeader('工记明细');
        doc.setTextColor(111, 123, 114);
        doc.setFontSize(8);
        doc.text(index === 0 ? '日期' : '日期（续）', margin, 34);
        doc.text('工时', pageWidth - 60, 34);
        doc.text('本笔金额', pageWidth - margin, 34, { align: 'right' });
        doc.setDrawColor(230, 224, 210);
        doc.line(margin, 37, pageWidth - margin, 37);
        let rowY = 46;
        for (const row of pageRows) {
          doc.setTextColor(52, 67, 58);
          doc.setFontSize(9);
          doc.text(row.label, margin, rowY);
          doc.text(`${formatHours(row.hours)} 小时`, pageWidth - 60, rowY);
          doc.text(formatMoney(row.amount, { symbol: true }), pageWidth - margin, rowY, {
            align: 'right',
          });
          doc.setDrawColor(239, 234, 223);
          doc.line(margin, rowY + 3, pageWidth - margin, rowY + 3);
          rowY += 6.2;
        }
        doc.setTextColor(111, 123, 114);
        doc.setFontSize(8);
        doc.text(`本页 ${pageRows.length} 笔 · 共 ${detailRows.length} 笔`, margin, 286);
      });
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setTextColor(111, 123, 114);
    doc.setFontSize(7.5);
    doc.text(`第 ${page} / ${totalPages} 页`, pageWidth - margin, 292, { align: 'right' });
  }

  return saveBlobFile(doc.output('blob'), pdfFileName(settlement));
}
