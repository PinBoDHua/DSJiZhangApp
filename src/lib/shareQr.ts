import qrcode from 'qrcode-generator';
import type { Settlement } from '../types';
import { settlementChecksum } from './checksum';
import { formatMoney } from './money';
import { paidAmountOf, remainingAmountOf } from './payment';

/** 二维码里只放结算摘要，不放完整工记，控制二维码尺寸也保护隐私。 */
export function buildSettlementShareText(settlement: Settlement): string {
  const start = settlement.periodStart.replace(/-/g, '.');
  const end = settlement.periodEnd.replace(/-/g, '.');
  const lines = [
    '薪时结算单',
    `工作：${settlement.jobName}`,
    `周期：${start} ~ ${end}`,
    `应发：${formatMoney(settlement.net, { symbol: true })}`,
    `已收：${formatMoney(paidAmountOf(settlement), { symbol: true })} 待收：${formatMoney(
      remainingAmountOf(settlement),
      { symbol: true },
    )}`,
    `结算：${settlement.createdAt.slice(0, 10)}`,
    `校验码：${settlementChecksum(settlement)}`,
    `单号：${settlement.id.slice(-8)}`,
  ];
  return lines.join('\n');
}

type QrCode = ReturnType<typeof qrcode>;

export interface SettlementQr {
  text: string;
  checksum: string;
  qr: QrCode;
  moduleCount: number;
  dataUrl: string;
}

export function createSettlementQr(
  text: string,
  cellSize = 6,
  margin = 4,
  checksum = '',
): SettlementQr {  // 库默认把字符按低 8 位截断；中文必须显式按 UTF-8 编码。
  qrcode.stringToBytes = (value: string) =>
    Array.from(new TextEncoder().encode(value));
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return {
    text,
    checksum,
    qr,
    moduleCount: qr.getModuleCount(),
    dataUrl: qr.createDataURL(cellSize, margin),
  };
}

export function createSettlementQrFor(settlement: Settlement): SettlementQr {
  return createSettlementQr(
    buildSettlementShareText(settlement),
    6,
    4,
    settlementChecksum(settlement),
  );
}

/** 把二维码画成白底 PNG，方便保存到相册 / 发给对方。 */
export function qrToPngBlob(qr: QrCode, cellSize = 8, margin = 24): Promise<Blob> {
  const size = qr.getModuleCount() * cellSize + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('浏览器不支持画布'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.translate(margin, margin);
  qr.renderTo2dContext(context, cellSize);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('二维码图片生成失败'));
    }, 'image/png');
  });
}
