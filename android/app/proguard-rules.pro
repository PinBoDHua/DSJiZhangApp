# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# 薪时自定义原生插件：通过类引用注册，保留类名与方法名。
-keep class com.xinshi.app.** { *; }
-keepattributes *Annotation*
-keepattributes RuntimeVisibleAnnotations, RuntimeInvisibleAnnotations, AnnotationDefault
-keepattributes Signature
-keepattributes InnerClasses

# Capacitor 插件注解元数据（上游 issue #8399 / PR #8400）
# R8 压缩 release 包时会裁掉 @CapacitorPlugin 以及它内嵌的 @Permission 数据，
# 运行时 Bridge.getPermissionStates() 读到 null 直接抛 NullPointerException，
# 崩在原生桥线程上，JS 的 try/catch 拦不住，表现为「一打开就闪退」。
# 触发点：LocalNotifications.checkPermissions()（有工作数据时首页会调用它排发薪提醒）。
-keep @interface com.getcapacitor.annotation.CapacitorPlugin { *; }
-keep @interface com.getcapacitor.annotation.Permission { *; }
-keep @interface com.getcapacitor.annotation.PermissionCallback { *; }
-keep @interface com.getcapacitor.annotation.ActivityCallback { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
