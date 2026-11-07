import { describe, expect, it } from 'vitest';
import { paydayNotificationBaseId } from './paydayNotifications';

describe('发薪通知 ID', () => {
  it('只由工作 ID 决定，不受列表顺序影响', () => {
    expect(paydayNotificationBaseId('job-a')).toBe(paydayNotificationBaseId('job-a'));
    expect(paydayNotificationBaseId('job-a')).not.toBe(paydayNotificationBaseId('job-b'));
    expect(paydayNotificationBaseId('job-a')).toBeGreaterThanOrEqual(100000);
  });
});
