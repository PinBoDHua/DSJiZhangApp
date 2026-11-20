import { isNativeApp } from './native';

type BackHandler = () => void;

const handlers: BackHandler[] = [];
let installed = false;

/**
 * C04：网页 / PWA 的返回桥。
 * 业务层照旧用 pushNativeBack 注册「关闭当前层」的回调；这里在栈里第一次出现回调时压一条
 * 同地址哨兵记录，浏览器返回键 / PWA 返回手势触发 popstate 时优先执行栈顶回调，再补回哨兵，
 * 避免直接退出页面、丢失未保存的录入。整条链只维护一条哨兵，history 不会无限增长。
 */
let sentinelActive = false;
// 主动撤销哨兵（关闭最后一个层）时，标记紧接着的那次 popstate 是自己引起的，不算用户按返回。
let droppingSentinel = false;
// 关闭层是 React 异步卸载（popstate 之后才移除回调），补哨兵要延后一拍再按剩余栈决定。
let rearmTimer = 0;
// 撤销哨兵也要延后一拍：子页之间直接切换时，旧层卸载与新层注册发生在同一次提交里，
// 立刻 history.back() 会把新层刚需要的哨兵一起弄丢。
let disarmTimer = 0;
let webBridgeInstalled = false;

function armSentinel(): void {
  // 有排队中的撤销就取消掉：哨兵还在，继续复用。
  window.clearTimeout(disarmTimer);
  disarmTimer = 0;
  if (sentinelActive) return;
  sentinelActive = true;
  // 只压一条同 URL 记录，不改地址；消费掉之后由 handlePopState 补回。
  window.history.pushState({ __xinshiBack: true }, '');
}

function scheduleDisarm(): void {
  if (!sentinelActive) return;
  window.clearTimeout(disarmTimer);
  disarmTimer = window.setTimeout(() => {
    disarmTimer = 0;
    // 期间又打开了新层：哨兵继续用，不能收。
    if (handlers.length > 0 || !sentinelActive) return;
    // 关闭最后一个层时把哨兵收掉，保证「首页再按返回」仍然直接退出 App，而不是先空按一次。
    sentinelActive = false;
    droppingSentinel = true;
    window.history.back();
  }, 0);
}

function handlePopState(): void {
  if (droppingSentinel) {
    droppingSentinel = false;
    sentinelActive = false;
    // 撤销过程中又打开了新层（极端时序）：补回哨兵，别让返回穿透出去。
    if (handlers.length > 0) armSentinel();
    return;
  }
  if (!sentinelActive) return; // 不是本桥压的哨兵，交还给浏览器默认行为
  sentinelActive = false;
  handlers[handlers.length - 1]?.();
  window.clearTimeout(rearmTimer);
  rearmTimer = window.setTimeout(() => {
    rearmTimer = 0;
    if (handlers.length > 0) armSentinel();
  }, 0);
}

/** 网页 / PWA 场景安装 popstate 返回桥；原生壳继续走 Capacitor 的 backButton，二者不并存。 */
export function installWebBack(): void {
  if (isNativeApp() || webBridgeInstalled) return;
  webBridgeInstalled = true;
  window.addEventListener('popstate', handlePopState);
}

/**
 * 注册一个返回处理函数（Android 返回键 / 浏览器返回键共用）。
 * 后注册的优先执行（例如弹层优先于子页面）。
 */
export function pushNativeBack(handler: BackHandler): () => void {
  handlers.push(handler);
  if (!isNativeApp()) armSentinel();
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
    if (!isNativeApp() && handlers.length === 0) scheduleDisarm();
  };
}

export async function installNativeBack(): Promise<void> {
  if (!isNativeApp() || installed) return;
  installed = true;
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', () => {
      const handler = handlers[handlers.length - 1];
      if (handler) {
        handler();
        return;
      }
      // 首页 / 引导页没有可关闭的层时，收起到后台，避免误触直接杀进程。
      void App.minimizeApp();
    });
  } catch {
    installed = false;
  }
}
