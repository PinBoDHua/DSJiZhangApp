import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockBodyScroll } from './scrollLock';

const body = { style: { overflow: '' } };

vi.stubGlobal('document', { body });

afterEach(() => {
  body.style.overflow = '';
});

describe('弹层滚动锁', () => {
  it('单个弹层关闭后恢复原值', () => {
    body.style.overflow = 'auto';
    const release = lockBodyScroll();
    expect(body.style.overflow).toBe('hidden');
    release();
    expect(body.style.overflow).toBe('auto');
  });

  it('嵌套弹层按任意顺序关闭都不会把页面锁死', () => {
    const outer = lockBodyScroll();
    const inner = lockBodyScroll();
    inner();
    expect(body.style.overflow).toBe('hidden');
    outer();
    expect(body.style.overflow).toBe('');
  });

  it('外层先关、内层后关时仍然保持锁定，最后恢复', () => {
    const outer = lockBodyScroll();
    const inner = lockBodyScroll();
    outer();
    expect(body.style.overflow).toBe('hidden');
    inner();
    expect(body.style.overflow).toBe('');
  });

  it('重复释放同一个句柄不会重复减计数', () => {
    const outer = lockBodyScroll();
    const inner = lockBodyScroll();
    inner();
    inner();
    expect(body.style.overflow).toBe('hidden');
    outer();
    expect(body.style.overflow).toBe('');
  });
});
