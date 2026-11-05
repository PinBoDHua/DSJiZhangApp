/**
 * 最小 XLSX 生成器：只要工作表、内联字符串、数字格式和冻结首行。
 * 不引入第三方依赖；ZIP 用 store 或 deflate-raw（不支持时自动退回 store）。
 */

export type CellStyle = 'default' | 'header' | 'money' | 'hours';

export interface XlsxCell {
  value: string | number;
  style?: CellStyle;
}

export type XlsxCellValue = string | number | XlsxCell | null | undefined;

export interface XlsxSheet {
  name: string;
  columns?: number[];
  rows: XlsxCellValue[][];
  /** 首行加粗并冻结，默认 true */
  header?: boolean;
  /** 自动筛选，默认 true（有表头时） */
  autoFilter?: boolean;
}

const STYLE_INDEX: Record<CellStyle, number> = {
  default: 0,
  header: 1,
  money: 2,
  hours: 3,
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function sheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31);
  if (!cleaned) throw new Error('工作表名称不能为空');
  return cleaned;
}

function normalizeCell(cell: XlsxCellValue): XlsxCell | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'string' || typeof cell === 'number') {
    return { value: cell };
  }
  return cell;
}

function cellXml(ref: string, cell: XlsxCell, style: CellStyle): string {
  const styleIndex = STYLE_INDEX[cell.style ?? style];
  if (typeof cell.value === 'number') {
    if (!Number.isFinite(cell.value)) return '';
    return `<c r="${ref}" s="${styleIndex}"><v>${cell.value}</v></c>`;
  }
  if (cell.value === '') return '';
  return `<c r="${ref}" s="${styleIndex}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
    String(cell.value),
  )}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows;
  const header = sheet.header !== false;
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const dimension = `A1:${columnName(Math.max(0, maxCols - 1))}${Math.max(1, rows.length)}`;
  const cols =
    sheet.columns && sheet.columns.length > 0
      ? `<cols>${sheet.columns
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${Math.max(6, width)}" customWidth="1"/>`,
          )
          .join('')}</cols>`
      : '';
  const sheetData = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((raw, colIndex) => {
          const cell = normalizeCell(raw);
          if (!cell) return '';
          const ref = `${columnName(colIndex)}${rowIndex + 1}`;
          return cellXml(ref, cell, rowIndex === 0 && header ? 'header' : 'default');
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  const pane = header
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    : '';
  const filter =
    sheet.autoFilter !== false && header && rows.length > 0
      ? `<autoFilter ref="${dimension}"/>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${cols}<sheetData>${sheetData}</sheetData>${filter}</worksheet>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function workbookXml(sheets: XlsxSheet[]): string {
  const sheetEntries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlEscape(sheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`;
}

function workbookRels(sheetCount: number): string {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypes(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`;
}

function rootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function writeU16(target: Uint8Array, offset: number, value: number): number {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  return offset + 2;
}

function writeU32(target: Uint8Array, offset: number, value: number): number {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
  return offset + 4;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function makeZip(files: ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const deflated = await deflateRaw(file.data);
    const compressed = deflated && deflated.length < file.data.length;
    const payload = compressed && deflated ? deflated : file.data;
    const method = compressed ? 8 : 0;

    const local = new Uint8Array(30 + name.length + payload.length);
    let cursor = 0;
    cursor = writeU32(local, cursor, 0x04034b50);
    cursor = writeU16(local, cursor, 20);
    cursor = writeU16(local, cursor, 0);
    cursor = writeU16(local, cursor, method);
    cursor = writeU16(local, cursor, DOS_TIME);
    cursor = writeU16(local, cursor, DOS_DATE);
    cursor = writeU32(local, cursor, crc);
    cursor = writeU32(local, cursor, payload.length);
    cursor = writeU32(local, cursor, file.data.length);
    cursor = writeU16(local, cursor, name.length);
    cursor = writeU16(local, cursor, 0);
    local.set(name, cursor);
    local.set(payload, cursor + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    cursor = 0;
    cursor = writeU32(central, cursor, 0x02014b50);
    cursor = writeU16(central, cursor, 20);
    cursor = writeU16(central, cursor, 20);
    cursor = writeU16(central, cursor, 0);
    cursor = writeU16(central, cursor, method);
    cursor = writeU16(central, cursor, DOS_TIME);
    cursor = writeU16(central, cursor, DOS_DATE);
    cursor = writeU32(central, cursor, crc);
    cursor = writeU32(central, cursor, payload.length);
    cursor = writeU32(central, cursor, file.data.length);
    cursor = writeU16(central, cursor, name.length);
    cursor = writeU16(central, cursor, 0);
    cursor = writeU16(central, cursor, 0);
    cursor = writeU16(central, cursor, 0);
    cursor = writeU16(central, cursor, 0);
    cursor = writeU32(central, cursor, 0);
    cursor = writeU32(central, cursor, offset);
    central.set(name, cursor);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  let cursor = 0;
  cursor = writeU32(end, cursor, 0x06054b50);
  cursor = writeU16(end, cursor, 0);
  cursor = writeU16(end, cursor, 0);
  cursor = writeU16(end, cursor, files.length);
  cursor = writeU16(end, cursor, files.length);
  cursor = writeU32(end, cursor, centralSize);
  cursor = writeU32(end, cursor, offset);
  cursor = writeU16(end, cursor, 0);

  return concat([...locals, ...centrals, end]);
}

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Uint8Array> {
  if (sheets.length === 0) throw new Error('至少需要一张工作表');
  const names = new Set<string>();
  const normalized = sheets.map((sheet) => {
    const name = sheetName(sheet.name);
    if (names.has(name)) throw new Error(`工作表名称重复：${name}`);
    names.add(name);
    return { ...sheet, name };
  });

  const encoder = new TextEncoder();
  const files: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes(normalized.length)) },
    { name: '_rels/.rels', data: encoder.encode(rootRels()) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(normalized)) },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encoder.encode(workbookRels(normalized.length)),
    },
    { name: 'xl/styles.xml', data: encoder.encode(stylesXml()) },
    ...normalized.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ];
  return makeZip(files);
}

export function xlsxBlob(data: Uint8Array): Blob {
  return new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
