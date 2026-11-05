import { describe, expect, it } from 'vitest';
import { digestText } from './crypto';
import {
  buildMovePackage,
  isMovePackage,
  moveFileName,
  parseMovePackage,
  shortChecksum,
  unlockMovePackage,
} from './movePackage';
import { makeEntry, makeJob, makeState } from './testFixtures';
import type { AppState } from '../types';

const now = new Date('2026-11-05T12:30:00.000Z');

function sampleState(): AppState {
  return makeState({
    jobs: [makeJob({ name: '测试工作' })],
    entries: [makeEntry({ id: 'entry-1', date: '2026-11-02' })],
  });
}

describe('搬家包', () => {
  it('明文包可以完整还原', async () => {
    const state = sampleState();
    const { text, header } = await buildMovePackage(state, { now, platform: 'android' });
    expect(isMovePackage(text)).toBe(true);
    expect(header.manifest.entries).toBe(1);
    expect(header.source).toMatchObject({ appVersion: '0.6.0', platform: 'android' });

    const result = await unlockMovePackage(text);
    expect(result.encrypted).toBe(false);
    expect(result.state.jobs[0].name).toBe('测试工作');
    expect(result.state.entries).toHaveLength(1);
  });

  it('加密包不泄露工作名，密码正确可还原', async () => {
    const { text } = await buildMovePackage(sampleState(), {
      now,
      password: 'right-password',
      passwordHint: '测试提示',
    });
    expect(text).not.toContain('测试工作');
    const result = await unlockMovePackage(text, 'right-password');
    expect(result.encrypted).toBe(true);
    expect(result.state.entries).toHaveLength(1);
    expect(result.header.passwordHint).toBe('测试提示');
  });

  it('密码错误时拒绝', async () => {
    const { text } = await buildMovePackage(sampleState(), {
      now,
      password: 'right-password',
    });
    await expect(unlockMovePackage(text, 'wrong-password')).rejects.toThrow('密码错误');
  });

  it('密文被改一个字符就拒绝', async () => {
    const { text } = await buildMovePackage(sampleState(), {
      now,
      password: 'right-password',
    });
    const parsed = JSON.parse(text);
    parsed.payload.data = `${parsed.payload.data.slice(0, -4)}AAAA`;
    await expect(unlockMovePackage(JSON.stringify(parsed), 'right-password')).rejects.toThrow(
      '校验失败',
    );
  });

  it('清单与内容不一致时拒绝', async () => {
    const { text } = await buildMovePackage(sampleState(), { now });
    const parsed = JSON.parse(text);
    parsed.manifest.entries += 1;
    const digest = await digestText(
      JSON.stringify({
        schemaVersion: parsed.schemaVersion,
        manifest: parsed.manifest,
        payload: parsed.payload,
      }),
    );
    parsed.checksum = `${digest.alg}:${digest.hex}`;
    await expect(unlockMovePackage(JSON.stringify(parsed))).rejects.toThrow('清单与内容不一致');
  });

  it('来自更高版本的包直接拒绝', async () => {
    const { text } = await buildMovePackage(sampleState(), { now });
    const parsed = JSON.parse(text);
    parsed.schemaVersion = 99;
    expect(() => parseMovePackage(JSON.stringify(parsed))).toThrow('升级');
  });

  it('密码至少 6 位', async () => {
    await expect(
      buildMovePackage(sampleState(), { now, password: '123' }),
    ).rejects.toThrow('至少 6 位');
  });

  it('文件名和短校验码可读', () => {
    expect(moveFileName(new Date(2026, 10, 5, 14, 30))).toBe('薪时搬家包-20261105-1430.json');
    expect(shortChecksum('sha256:9f2c8a10aa')).toBe('9F2C8A10');
  });
});
