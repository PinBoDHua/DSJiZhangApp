import type { AppState } from '../types';

/** 一次尚未落盘的更新函数；跨标签页冲突时按提交顺序重放。 */
export type StateUpdater = (previous: AppState) => AppState;

/**
 * 乐观合并：把本窗口尚未落盘的一串更新，按提交顺序重放到其他标签页刚写入的远端账本上。
 *
 * 只用于「远端已变化、本地还压着未保存改动」的冲突窗口。更新函数要求是纯函数
 * （只依赖入参与闭包里刚生成的新记录），因此重放后两边的改动都能保留：
 * 远端账本里的记录不丢，本窗口的新增/修改也会叠加上去。
 * 注意：整包替换意图的更新（如 settleJob 直接返回整本新状态）重放时会覆盖远端，
 * 这类写入依赖 D09 的 epoch 广播兜底，不在本函数裁决范围内。
 */
export function replayUpdaters(
  remote: AppState,
  updaters: readonly StateUpdater[],
): AppState {
  let merged = remote;
  for (const updater of updaters) merged = updater(merged);
  return merged;
}

/** 远端原文非空且与本窗口上次写入的不一致 → 别的标签页已经改过账本。 */
export function isRemoteDirty(
  remoteRaw: string | null,
  lastPersistedRaw: string | null,
): boolean {
  return remoteRaw !== null && remoteRaw !== lastPersistedRaw;
}
