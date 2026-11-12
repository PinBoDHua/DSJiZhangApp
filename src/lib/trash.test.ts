import { describe, expect, it } from 'vitest';
import {
  buildTrashRows,
  filterTrashRows,
  limitTrash,
  purgeExpiredTrash,
  pushTrash,
  summarizeTrash,
  trashRemainingDays,
  trashRestoreBlockReason,
} from './trash';
import { makeAdvance, makeEntry, makeJob, makeRestDay, makeSettlement, makeState } from './testFixtures';

const NOW = new Date('2026-11-06T12:00:00.000Z').getTime();
const daysAgo = (days: number) =>
  new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe('回收站保留与容量', () => {
  it('超过 30 天或时间无效的记录会被清理', () => {
    const items = [
      { id: 'old', deletedAt: daysAgo(31) },
      { id: 'edge', deletedAt: daysAgo(29) },
      { id: 'bad', deletedAt: 'not-a-date' },
    ];
    expect(purgeExpiredTrash(items, NOW).map((item) => item.id)).toEqual(['edge']);
  });

  it('剩余天数在删除当天是 30 天，之后逐日减少', () => {
    expect(trashRemainingDays(daysAgo(0), NOW)).toBe(30);
    expect(trashRemainingDays(daysAgo(10), NOW)).toBe(20);
    expect(trashRemainingDays(daysAgo(40), NOW)).toBe(0);
    expect(trashRemainingDays('bad-date', NOW)).toBe(0);
  });

  it('新删除的项目排在最前，同 ID 覆盖，超过上限时丢掉最旧的', () => {
    const list = [
      { id: 'a', deletedAt: daysAgo(1) },
      { id: 'b', deletedAt: daysAgo(2) },
    ];
    expect(pushTrash(list, { id: 'c', deletedAt: daysAgo(0) }, (item) => item.id, 2)).toEqual([
      { id: 'c', deletedAt: daysAgo(0) },
      { id: 'a', deletedAt: daysAgo(1) },
    ]);
    expect(
      pushTrash(list, { id: 'b', deletedAt: daysAgo(0) }, (item) => item.id, 2).map(
        (item) => item.id,
      ),
    ).toEqual(['b', 'a']);
  });

  it('limitTrash 按删除时间倒序裁剪', () => {
    const items = [
      { id: 'old', deletedAt: daysAgo(5) },
      { id: 'new', deletedAt: daysAgo(1) },
      { id: 'mid', deletedAt: daysAgo(3) },
    ];
    expect(limitTrash(items, 2).map((item) => item.id)).toEqual(['new', 'mid']);
  });
});

describe('回收站列表', () => {
  const job = makeJob();
  const deletedJob = makeJob({ id: 'job-2', name: '已删工作' });
  const state = makeState({
    jobs: [job],
    trashedJobs: [{ job: deletedJob, deletedAt: daysAgo(1) }],
    trashedEntries: [{ entry: makeEntry({ hours: 8 }), deletedAt: daysAgo(2) }],
    trashedRests: [
      { restDay: makeRestDay({ days: 0.5, note: '调休' }), deletedAt: daysAgo(3) },
    ],
    trashedAdvances: [
      { advance: makeAdvance({ amount: 500, note: '生活费' }), deletedAt: daysAgo(4) },
    ],
  });

  it('四类记录都能生成可读的行，并按删除时间倒序', () => {
    const rows = buildTrashRows(state, NOW);
    expect(rows.map((row) => row.kind)).toEqual(['job', 'entry', 'rest', 'advance']);
    expect(rows[0].title).toBe('已删工作');
    expect(rows[1].title).toContain('11月2日');
    expect(rows[1].subtitle).toContain('测试工作');
    expect(rows[1].amount).toBe(200);
    expect(rows[1].hours).toBe(8);
    expect(rows[2].subtitle).toContain('半天休息');
    expect(rows[2].restDays).toBe(0.5);
    expect(rows[3].amount).toBe(500);
    expect(rows.every((row) => row.remainingDays >= 0)).toBe(true);
  });

  it('汇总累计可恢复的金额、工时和休息天数', () => {
    expect(summarizeTrash(buildTrashRows(state, NOW))).toEqual({
      count: 4,
      amount: 700,
      hours: 8,
      restDays: 0.5,
    });
  });

  it('按类型与工作组合筛选', () => {
    const rows = buildTrashRows(state, NOW);
    expect(filterTrashRows(rows, 'entry', 'all').map((row) => row.kind)).toEqual(['entry']);
    expect(filterTrashRows(rows, 'all', 'job-1').map((row) => row.kind)).toEqual([
      'entry',
      'rest',
      'advance',
    ]);
    expect(filterTrashRows(rows, 'job', 'all').map((row) => row.kind)).toEqual(['job']);
    expect(filterTrashRows(rows, 'entry', 'job-2')).toEqual([]);
  });

  it('带考勤照片的工记行有标记', () => {
    const photoRows = buildTrashRows(
      makeState({
        jobs: [job],
        trashedEntries: [
          { entry: makeEntry({ photoId: 'photo-1' }), deletedAt: daysAgo(1) },
        ],
      }),
      NOW,
    );
    expect(photoRows[0].hasPhoto).toBe(true);
  });
});

describe('恢复前的拦截理由', () => {
  const job = makeJob();
  const entryRow = buildTrashRows(
    makeState({
      jobs: [job],
      trashedEntries: [{ entry: makeEntry({ hours: 8 }), deletedAt: daysAgo(1) }],
    }),
    NOW,
  )[0];

  it('原工作不存在时说明原因', () => {
    expect(trashRestoreBlockReason(entryRow, makeState({ jobs: [] }), NOW)).toBe(
      '原工作已彻底删除，无法恢复',
    );
    expect(
      trashRestoreBlockReason(
        entryRow,
        makeState({ jobs: [], trashedJobs: [{ job, deletedAt: daysAgo(1) }] }),
        NOW,
      ),
    ).toBe('原工作还在回收站，先恢复工作');
  });

  it('已结算的时间段不能恢复', () => {
    const settlement = makeSettlement({ periodStart: '2026-11-02', periodEnd: '2026-11-08' });
    expect(
      trashRestoreBlockReason(
        entryRow,
        makeState({ jobs: [job], settlements: [settlement] }),
        NOW,
      ),
    ).toBe('这段时间已结算，先撤销结算再恢复');
  });

  it('同日合计超过 24 小时不能恢复', () => {
    const other = makeEntry({ id: 'entry-2', hours: 20 });
    expect(
      trashRestoreBlockReason(entryRow, makeState({ jobs: [job], entries: [other] }), NOW),
    ).toBe('这天合计会超过 24 小时');
  });

  it('同一天已有休息时不能恢复工记', () => {
    expect(
      trashRestoreBlockReason(
        entryRow,
        makeState({ jobs: [job], restDays: [makeRestDay({ date: '2026-11-02' })] }),
        NOW,
      ),
    ).toBe('这天已有休息，先取消休息再恢复');
  });

  it('休息和工记同一天只能留一个', () => {
    const restRow = buildTrashRows(
      makeState({
        jobs: [job],
        trashedRests: [{ restDay: makeRestDay(), deletedAt: daysAgo(1) }],
      }),
      NOW,
    )[0];
    expect(
      trashRestoreBlockReason(
        restRow,
        makeState({ jobs: [job], entries: [makeEntry({ date: '2026-11-03' })] }),
        NOW,
      ),
    ).toBe('这天已有工记，休息和工记只能留一个');
    expect(
      trashRestoreBlockReason(restRow, makeState({ jobs: [job], restDays: [makeRestDay()] }), NOW),
    ).toBe(null);
  });

  it('工作本身没有恢复限制', () => {
    const jobRow = buildTrashRows(
      makeState({ trashedJobs: [{ job, deletedAt: daysAgo(1) }] }),
      NOW,
    )[0];
    expect(jobRow.kind).toBe('job');
    expect(trashRestoreBlockReason(jobRow, makeState(), NOW)).toBeNull();
  });

  it('删除满 30 天后不能再恢复，未满保留期仍可恢复', () => {
    const expiredJob = makeJob({ id: 'job-expired', name: '过期工作' });
    const rowAfter = (days: number) =>
      buildTrashRows(
        makeState({ trashedJobs: [{ job: expiredJob, deletedAt: daysAgo(days) }] }),
        NOW,
      )[0];

    const day31 = rowAfter(31);
    expect(day31.remainingDays).toBe(0);
    expect(trashRestoreBlockReason(day31, makeState(), NOW)).toBe(
      '已超过 30 天保留期，无法恢复',
    );

    // 保留期边界：满 30 天剩余天数为 0，已经不能恢复。
    const day30 = rowAfter(30);
    expect(day30.remainingDays).toBe(0);
    expect(trashRestoreBlockReason(day30, makeState(), NOW)).toBe(
      '已超过 30 天保留期，无法恢复',
    );

    // 前一天仍在保留期内，工作类型没有其他恢复限制。
    const day29 = rowAfter(29);
    expect(day29.remainingDays).toBe(1);
    expect(trashRestoreBlockReason(day29, makeState(), NOW)).toBeNull();
  });
});
