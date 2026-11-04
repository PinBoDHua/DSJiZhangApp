import { isNativeApp } from './native';

type BackHandler = () => void;

const handlers: BackHandler[] = [];
let installed = false;

/**
 * 注册一个 Android 返回键处理函数。
 * 后注册的优先执行（例如弹层优先于子页面）。
 */
export function pushNativeBack(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
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
