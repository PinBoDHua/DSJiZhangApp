import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx, crc32, xlsxBlob } from './xlsx';

function readZip(data: Uint8Array): Map<string, { text: string; method: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, { text: string; method: number }>();
  let offset = 0;
  while (offset + 4 <= data.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(data.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const raw = data.subarray(start, start + compressedSize);
    const bytes = method === 8 ? inflateRawSync(raw) : raw;
    files.set(name, { text: decoder.decode(bytes), method });
    offset = start + compressedSize;
  }
  return files;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('XLSX 生成', () => {
  it('CRC32 与标准值一致', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('生成包含内容类型、工作簿和工作表的 zip', async () => {
    const data = await buildXlsx([
      {
        name: '工记明细',
        columns: [12, 8],
        rows: [
          ['日期', '工时'],
          ['2026-11-02', { value: 8.5, style: 'hours' }],
          ['<备注 & 特殊>', { value: 200, style: 'money' }],
        ],
      },
      { name: '结算单', rows: [['应发'], [{ value: 200, style: 'money' }]] },
    ]);
    const files = readZip(data);
    expect(files.has('[Content_Types].xml')).toBe(true);
    expect(files.has('xl/workbook.xml')).toBe(true);
    expect(files.has('xl/styles.xml')).toBe(true);
    expect(files.has('xl/worksheets/sheet1.xml')).toBe(true);
    expect(files.has('xl/worksheets/sheet2.xml')).toBe(true);

    const sheet = files.get('xl/worksheets/sheet1.xml')?.text ?? '';
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('s="1"');
    expect(sheet).toContain('s="2"');
    expect(sheet).toContain('s="3"');
    expect(sheet).toContain('&lt;备注 &amp; 特殊&gt;');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter');
    expect(files.get('xl/workbook.xml')?.text).toContain('name="工记明细"');
  });

  it('环境中没有 CompressionStream 时退回 store 方式', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const data = await buildXlsx([{ name: 'S', rows: [['A'], ['B']] }]);
    const files = readZip(data);
    expect(files.get('xl/worksheets/sheet1.xml')?.method).toBe(0);
    expect(files.get('xl/worksheets/sheet1.xml')?.text).toContain('>A<');
  });

  it('拒绝空表、重复名称和非法名称', async () => {
    await expect(buildXlsx([])).rejects.toThrow('至少需要一张工作表');
    await expect(
      buildXlsx([
        { name: '重复', rows: [['A']] },
        { name: '重复', rows: [['B']] },
      ]),
    ).rejects.toThrow('重复');
    await expect(buildXlsx([{ name: '   ', rows: [['A']] }])).rejects.toThrow('不能为空');
  });

  it('返回正确的 MIME 类型 Blob', async () => {
    const data = await buildXlsx([{ name: 'S', rows: [['A']] }]);
    const blob = xlsxBlob(data);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(blob.size).toBeGreaterThan(0);
  });
});
