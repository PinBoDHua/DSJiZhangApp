import type { Settlement } from '../types';
import { formatDateTime } from './date';
import { formatMoney, splitMoney } from './money';
import { saveBlobFile } from './native';

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const W = 1080;
const H = 1440;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const radius = size * 0.28;
  roundRect(ctx, x, y, size, size, radius);
  ctx.fillStyle = '#F7F1E3';
  ctx.fill();
  const cx = x + size * 0.47;
  const cy = y + size * 0.54;
  const clock = size * 0.28;
  ctx.strokeStyle = '#14563D';
  ctx.lineWidth = size * 0.056;
  ctx.beginPath();
  ctx.arc(cx, cy, clock, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - clock * 0.52);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + clock * 0.44, cy + clock * 0.26);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size * 0.8, y + size * 0.2, size * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = '#E9A13B';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + size * 0.8, y + size * 0.2, size * 0.032, 0, Math.PI * 2);
  ctx.fillStyle = '#14563D';
  ctx.fill();
}

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  min: number,
  weight = 700,
): number {
  let size = start;
  while (size > min) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return min;
}

function dashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y: number,
  x2: number,
  color = '#E0D9C8',
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function moneyText(value: number, negative = false): string {
  return `${negative ? '−' : ''}${formatMoney(Math.abs(value), { symbol: true })}`;
}

export async function createPayslipBlob(
  settlement: Settlement,
  accent: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片生成');

  ctx.fillStyle = '#F4F1E8';
  ctx.fillRect(0, 0, W, H);

  const topGradient = ctx.createLinearGradient(0, 0, W, 400);
  topGradient.addColorStop(0, '#0D3828');
  topGradient.addColorStop(0.55, '#14563D');
  topGradient.addColorStop(1, '#1D6449');
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, W, 390);

  ctx.strokeStyle = 'rgba(248, 242, 229, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(950, 40, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(950, 40, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(233, 161, 59, 0.12)';
  ctx.beginPath();
  ctx.arc(980, 0, 120, 0, Math.PI * 2);
  ctx.fill();

  drawLogo(ctx, 72, 60, 88);
  ctx.fillStyle = '#F8F2E5';
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText('薪时', 180, 112);
  ctx.fillStyle = 'rgba(248, 242, 229, 0.52)';
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText('XINSHI · 每一小时都算数', 181, 138);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(248, 242, 229, 0.82)';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText('工资条', 1008, 108);
  ctx.fillStyle = 'rgba(248, 242, 229, 0.45)';
  ctx.font = `500 14px ${FONT}`;
  ctx.fillText('WORK SLIP', 1008, 134);
  ctx.textAlign = 'left';

  // 主卡片
  ctx.save();
  ctx.shadowColor = 'rgba(23, 37, 31, 0.16)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  roundRect(ctx, 56, 250, 968, 1050, 38);
  ctx.fillStyle = '#FFFDF8';
  ctx.fill();
  ctx.restore();

  // 顶部工作色条
  roundRect(ctx, 104, 326, 8, 56, 4);
  ctx.fillStyle = accent;
  ctx.fill();

  const jobSize = fitFont(ctx, settlement.jobName, 590, 40, 28, 700);
  ctx.fillStyle = '#17251F';
  ctx.font = `700 ${jobSize}px ${FONT}`;
  ctx.fillText(settlement.jobName, 132, 368);

  ctx.fillStyle = '#6F7B72';
  ctx.font = `400 20px ${FONT}`;
  const period = `${settlement.periodStart.replace(/-/g, '.')} – ${settlement.periodEnd.replace(
    /-/g,
    '.',
  )}`;
  ctx.fillText(period, 104, 408);

  // 已结算标记
  roundRect(ctx, 846, 314, 162, 44, 22);
  ctx.fillStyle = '#E4EFE7';
  ctx.fill();
  ctx.fillStyle = '#14563D';
  ctx.font = `600 18px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('已结算', 927, 343);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#6F7B72';
  ctx.font = `500 20px ${FONT}`;
  ctx.fillText('应发净额', 104, 478);

  // 金额
  const { negative, int, decimal } = splitMoney(settlement.net);
  ctx.fillStyle = negative ? '#B3402F' : '#C48128';
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText(negative ? '−¥' : '¥', 104, 556);

  const amountSize = Math.min(
    96,
    (() => {
      let size = 96;
      while (size > 56) {
        ctx.font = `700 ${size}px ${FONT}`;
        if (ctx.measureText(int).width <= 660) return size;
        size -= 4;
      }
      return 56;
    })(),
  );
  ctx.fillStyle = negative ? '#B3402F' : '#17251F';
  ctx.font = `700 ${amountSize}px ${FONT}`;
  ctx.fillText(int, 158, 556);
  const intWidth = ctx.measureText(int).width;
  ctx.fillStyle = '#8A958C';
  ctx.font = `600 ${Math.round(amountSize * 0.42)}px ${FONT}`;
  ctx.fillText(`.${decimal}`, 158 + intWidth + 4, 556);

  dashedLine(ctx, 104, 604, 976);

  const rows: Array<{ label: string; value: number; negative?: boolean }> = [
    {
      label:
        settlement.payType === 'piece'
          ? '计件工资'
          : settlement.payType === 'monthly' && settlement.monthlyMode === 'fixed'
            ? '固定月薪'
            : '基础工资',
      value: settlement.base,
    },
    { label: '加班工资', value: settlement.otPay },
    { label: '奖金补贴', value: settlement.bonus + settlement.extraBonus },
    { label: '扣款', value: settlement.deduction + settlement.extraDeduction, negative: true },
    { label: '借支抵扣', value: settlement.advanceTotal, negative: true },
  ].filter((row) => row.value > 0);

  let rowY = 660;
  for (const row of rows) {
    ctx.fillStyle = '#34433A';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(row.label, 104, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = row.negative ? '#B3402F' : '#17251F';
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(moneyText(row.value, row.negative), 976, rowY);
    ctx.textAlign = 'left';
    dashedLine(ctx, 104, rowY + 18, 976, '#EFEADF');
    rowY += 58;
  }

  const totalY = Math.max(rowY + 8, 850);
  ctx.fillStyle = '#0F4631';
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText('应发净额', 104, totalY);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#14563D';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(moneyText(settlement.net, negative), 976, totalY);
  ctx.textAlign = 'left';

  // 统计面板
  const statsY = Math.max(totalY + 42, 940);
  roundRect(ctx, 104, statsY, 872, 122, 24);
  ctx.fillStyle = '#F3F6EF';
  ctx.fill();
  const stats =
    settlement.payType === 'piece'
      ? [
          {
            label: '数量',
            value: `${settlement.quantity ?? 0} ${settlement.unitLabel || '件'}`,
          },
          { label: '工时', value: `${settlement.hours} 小时` },
          { label: '出勤', value: `${settlement.days} 天` },
        ]
      : settlement.payType === 'monthly' && settlement.monthlyMode === 'fixed'
        ? [
            { label: '出勤', value: `${settlement.days} 天` },
            { label: '休息', value: `${settlement.restDays ?? 0} 天` },
            { label: '工时', value: `${settlement.hours} 小时` },
          ]
        : [
            { label: '出勤', value: `${settlement.days} 天` },
            { label: '工时', value: `${settlement.hours} 小时` },
            { label: '加班', value: `${settlement.otHours} 小时` },
          ];
  stats.forEach((item, index) => {
    const cx = 104 + 872 * ((index + 0.5) / 3);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7A857C';
    ctx.font = `400 18px ${FONT}`;
    ctx.fillText(item.label, cx, statsY + 43);
    ctx.fillStyle = '#17251F';
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(item.value, cx, statsY + 82);
    ctx.textAlign = 'left';
  });

  if (settlement.note) {
    ctx.fillStyle = '#6F7B72';
    ctx.font = `400 18px ${FONT}`;
    const note = settlement.note.length > 42 ? `${settlement.note.slice(0, 42)}…` : settlement.note;
    ctx.fillText(`备注：${note}`, 104, statsY + 168);
  }

  // 结算章，填一点留白也让工资条更有凭证感
  ctx.save();
  ctx.translate(848, 1235);
  ctx.rotate(-0.1);
  ctx.strokeStyle = 'rgba(20, 86, 61, 0.16)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 56, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(20, 86, 61, 0.4)';
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText('已结算', 0, 4);
  ctx.font = `500 9px ${FONT}`;
  ctx.fillText('薪时 · XINSHI', 0, 24);
  ctx.restore();
  ctx.textAlign = 'left';

  // 底部品牌
  ctx.fillStyle = '#14563D';
  ctx.font = `700 22px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('薪时 · 每一小时，都算数。', 540, 1352);
  ctx.fillStyle = '#8A958C';
  ctx.font = `400 15px ${FONT}`;
  ctx.fillText(`结算于 ${formatDateTime(settlement.createdAt)} · 个人记账参考`, 540, 1384);
  ctx.textAlign = 'left';

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('工资条图片生成失败'));
    }, 'image/png');
  });
}

export function payslipFileName(settlement: Settlement): string {
  const safeJob = settlement.jobName.replace(/[\\/:*?"<>|]/g, '').slice(0, 16);
  return `薪时工资条-${safeJob}-${settlement.periodEnd}.png`;
}

export function payslipPdfFileName(settlement: Settlement): string {
  return payslipFileName(settlement).replace(/\.png$/, '.pdf');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** 把工资条 PNG 放进一张 1080×1440 的 PDF，方便打印 / 归档。 */
export async function downloadPayslipPdf(
  blob: Blob,
  settlement: Settlement,
): Promise<'web' | 'native'> {
  const [{ jsPDF }, dataUrl] = await Promise.all([import('jspdf'), blobToDataUrl(blob)]);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'px',
    format: [1080, 1440],
    compress: true,
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, 1080, 1440, undefined, 'FAST');
  return saveBlobFile(pdf.output('blob'), payslipPdfFileName(settlement));
}
