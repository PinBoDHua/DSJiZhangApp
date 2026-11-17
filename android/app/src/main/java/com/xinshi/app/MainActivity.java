package com.xinshi.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private static final long RENDERER_STABLE_MS = 30_000L;
    private static int rendererCrashCount = 0;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String safeAreaScript = "";
    private final Runnable resetRendererCrashCount = () -> {
        rendererCrashCount = 0;
        XinshiApp.mark("webview:renderer crash count reset");
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        XinshiApp.mark("activity:onCreate start");
        registerPlugin(SaveFilePlugin.class);
        XinshiApp.mark("activity:savefile registered");
        try {
            super.onCreate(savedInstanceState);
            XinshiApp.mark("activity:super.onCreate done");
        } catch (Throwable error) {
            showCrashScreen(error);
            return;
        }

        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                installSafeAreaInsets(bridge);
                bridge.addWebViewListener(new WebViewListener() {
                    @Override
                    public void onPageStarted(WebView view) {
                        XinshiApp.mark("webview:pageStart url=" + safeUrl(view));
                        applySafeAreaScript(view);
                    }

                    @Override
                    public void onPageLoaded(WebView view) {
                        XinshiApp.mark("webview:pageLoaded url=" + safeUrl(view));
                        applySafeAreaScript(view);
                        mainHandler.removeCallbacks(resetRendererCrashCount);
                        mainHandler.postDelayed(resetRendererCrashCount, RENDERER_STABLE_MS);
                        if (BuildConfig.XINSHI_DIAG) {
                            XinshiApp.export();
                        }
                    }

                    @Override
                    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                        boolean didCrash = detail != null && detail.didCrash();
                        XinshiApp.mark("webview:renderProcessGone didCrash=" + didCrash);
                        try {
                            destroyWebView(view);
                        } catch (Throwable error) {
                            showCrashScreen(error);
                            return true;
                        }
                        if (!didCrash) {
                            // 系统低内存回收（LMK）不是崩溃：不计数、不导出诊断，直接重建 WebView（AND-08）。
                            XinshiApp.mark("webview:renderer recycled by system, recreate");
                            try {
                                recreate();
                            } catch (Throwable error) {
                                showCrashScreen(error);
                            }
                            return true;
                        }
                        // 真崩溃才计数与导出（export 内部还会按构建类型二次守卫，正式包不写公共目录）。
                        XinshiApp.export();
                        rendererCrashCount++;
                        mainHandler.removeCallbacks(resetRendererCrashCount);
                        if (rendererCrashCount > 1) {
                            showCrashScreen(new IllegalStateException("WebView 渲染进程反复崩溃"));
                            return true;
                        }
                        try {
                            recreate();
                        } catch (Throwable error) {
                            showCrashScreen(error);
                        }
                        // 返回 true 表示自己处理，避免系统把整个 App 杀掉。
                        return true;
                    }
                });
            }
        } catch (Throwable error) {
            XinshiApp.mark("activity:listener failed " + error);
        }
    }

    @Override
    public void onStart() {
        XinshiApp.mark("activity:onStart");
        super.onStart();
        XinshiApp.mark("activity:onStart done");
    }

    @Override
    public void onResume() {
        super.onResume();
        XinshiApp.mark("activity:onResume");
        if (BuildConfig.XINSHI_DIAG) {
            XinshiApp.export();
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(resetRendererCrashCount);
        super.onDestroy();
    }

    /** WebView 的 env(safe-area-inset-*) 在部分 ROM 上恒为 0，直接桥接系统 inset。 */
    private void installSafeAreaInsets(Bridge bridge) {
        final WebView webView = bridge.getWebView();
        if (webView == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = view.getResources().getDisplayMetrics().density;
            // onPageStarted 时新文档的 documentElement 可能还没建好，脚本要自己兜底，避免每次加载都抛异常。
            safeAreaScript = "(function(){var d=document.documentElement;if(!d||!d.style){return;}"
                + "d.style.setProperty('--safe-top','" + (insets.top / density) + "px');"
                + "d.style.setProperty('--safe-right','" + (insets.right / density) + "px');"
                + "d.style.setProperty('--safe-bottom','" + (insets.bottom / density) + "px');"
                + "d.style.setProperty('--safe-left','" + (insets.left / density) + "px');})();";
            applySafeAreaScript(webView);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    private void applySafeAreaScript(WebView view) {
        if (view == null || safeAreaScript.isEmpty()) return;
        view.evaluateJavascript(safeAreaScript, null);
    }

    private static void destroyWebView(WebView view) {
        if (view == null) return;
        ViewParent parent = view.getParent();
        if (parent instanceof ViewGroup) {
            ((ViewGroup) parent).removeView(view);
        }
        view.destroy();
    }

    private static String safeUrl(WebView view) {
        try {
            return view == null ? "null" : String.valueOf(view.getUrl());
        } catch (Throwable error) {
            return "error";
        }
    }

    /** 原生崩溃页：显示截断后的启动日志与堆栈，并提供「重启应用 / 退出」出口（AND-09）。 */
    private void showCrashScreen(Throwable error) {
        XinshiApp.crash(Thread.currentThread(), error);
        // 兜底返回回调：崩溃页的 WebView 可能已被销毁，AppPlugin 的 JS 返回回调仍活着，
        // 这里在返回分发器栈顶加一个原生回调拦住返回键，避免事件继续发进死 WebView。
        // 用无 LifecycleOwner 重载：崩溃页可能出现在 onCreate 未完成时，此回调需始终生效。
        getOnBackPressedDispatcher().addCallback(new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                exitApp();
            }
        });
        StringBuilder text = new StringBuilder();
        text.append("薪时启动失败（诊断页）\n")
            .append("设备：").append(android.os.Build.MANUFACTURER).append(' ')
            .append(android.os.Build.MODEL)
            .append("  Android ").append(android.os.Build.VERSION.RELEASE)
            .append(" (API ").append(android.os.Build.VERSION.SDK_INT).append(")\n");
        text.append("\n----- 启动节点（仅尾部日志） -----\n").append(XinshiApp.readLog());
        text.append("\n----- 崩溃堆栈（过长会截断） -----\n");
        java.io.StringWriter writer = new java.io.StringWriter();
        error.printStackTrace(new java.io.PrintWriter(writer));
        String stack = writer.toString();
        int maxStackChars = 24 * 1024;
        if (stack.length() > maxStackChars) {
            text.append(stack, 0, maxStackChars).append("\n...（堆栈过长已截断）");
        } else {
            text.append(stack);
        }

        ScrollView scroll = new ScrollView(this);
        TextView view = new TextView(this);
        view.setText(text.toString());
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9f);
        view.setTextIsSelectable(true);
        int padding = Math.round(getResources().getDisplayMetrics().density * 12);
        view.setPadding(padding, padding, padding, padding);
        scroll.addView(view, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.addView(scroll, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setPadding(padding, padding, padding, padding);
        Button restart = new Button(this);
        restart.setText("重启应用");
        restart.setOnClickListener((v) -> {
            try {
                recreate();
            } catch (Throwable restartError) {
                exitApp();
            }
        });
        Button exit = new Button(this);
        exit.setText("退出");
        exit.setOnClickListener((v) -> exitApp());
        actions.addView(restart, new LinearLayout.LayoutParams(
            0,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            1f
        ));
        actions.addView(exit, new LinearLayout.LayoutParams(
            0,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            1f
        ));
        root.addView(actions, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        setContentView(root);
    }

    /** 崩溃页后备出口：优先结束整个任务栈，避免用户被困在诊断页。 */
    private void exitApp() {
        try {
            finishAffinity();
        } catch (Throwable ignored) {
            finish();
        }
    }
}
