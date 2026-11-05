package com.xinshi.app;

import android.os.Bundle;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.ScrollView;
import android.widget.TextView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private int rendererCrashCount = 0;

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
                bridge.addWebViewListener(new WebViewListener() {
                    @Override
                    public void onPageStarted(WebView view) {
                        XinshiApp.mark("webview:pageStart url=" + safeUrl(view));
                    }

                    @Override
                    public void onPageLoaded(WebView view) {
                        XinshiApp.mark("webview:pageLoaded url=" + safeUrl(view));
                        if (BuildConfig.XINSHI_DIAG) {
                            XinshiApp.export();
                        }
                    }

                    @Override
                    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                        XinshiApp.mark("webview:renderProcessGone didCrash=" + (detail != null && detail.didCrash()));
                        XinshiApp.export();
                        rendererCrashCount++;
                        if (rendererCrashCount > 1) {
                            showCrashScreen(new IllegalStateException("WebView 渲染进程反复崩溃"));
                            return true;
                        }
                        // 返回 true 表示自己处理，避免系统把整个 App 杀掉；随后重载页面
                        if (view != null) {
                            view.post(() -> {
                                try {
                                    view.reload();
                                } catch (Throwable ignored) {
                                    // 忽略
                                }
                            });
                        }
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

    private static String safeUrl(WebView view) {
        try {
            return view == null ? "null" : String.valueOf(view.getUrl());
        } catch (Throwable error) {
            return "error";
        }
    }

    /** 原生崩溃页：把启动日志与堆栈直接显示在屏幕上，方便截图反馈。 */
    private void showCrashScreen(Throwable error) {
        XinshiApp.crash(Thread.currentThread(), error);
        StringBuilder text = new StringBuilder();
        text.append("薪时启动失败（诊断页）\n")
            .append("设备：").append(android.os.Build.MANUFACTURER).append(' ')
            .append(android.os.Build.MODEL)
            .append("  Android ").append(android.os.Build.VERSION.RELEASE)
            .append(" (API ").append(android.os.Build.VERSION.SDK_INT).append(")\n");
        text.append("\n----- 启动节点 -----\n").append(XinshiApp.readLog());
        text.append("\n----- 崩溃堆栈 -----\n");
        java.io.StringWriter writer = new java.io.StringWriter();
        error.printStackTrace(new java.io.PrintWriter(writer));
        text.append(writer);

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
        setContentView(scroll);
    }
}
