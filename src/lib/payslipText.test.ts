import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPayslipPdfFont } from './payslipText';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('文字版 PDF 中文字体加载', () => {
  it('字体文件缺失时透出 HTTP 状态，而不是只报通用错误（PAY-24）', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }) as Response);
    await expect(loadPayslipPdfFont()).rejects.toThrow('HTTP 404');
  });

  it('字体请求异常时透出底层原因', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    await expect(loadPayslipPdfFont()).rejects.toThrow('network down');
  });
});
