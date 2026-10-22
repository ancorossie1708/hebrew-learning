package org.hebrewlearning.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/** Offline HTTPS origin, verified GitHub updates and explicit screen orientation. */
public class MainActivity extends Activity {
    private static final String HOST="appassets.androidplatform.net";
    private static final String START="https://"+HOST+"/assets/prototype/index.html";
    private WebView lessons;
    private ContentStore content;
    private LearningBridge bridge;
    private boolean loaded,installPermission,updatePromptShown;
    private long lastCheck;
    private File pendingApk;
    private String installJob="";

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        applyLayout(getPreferences(MODE_PRIVATE).getString("layout","phone"));
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::back);
        try {
            content=new ContentStore(this);
            bridge=new LearningBridge(this,content);
            createWebView();
        } catch(IOException error) {
            new AlertDialog.Builder(this).setTitle("Unable to open lessons")
                    .setMessage("Please free some device storage and reopen the app.")
                    .setPositiveButton("Close",(dialog,which)->finish()).setCancelable(false).show();
        }
    }

    @SuppressLint("SetJavaScriptEnabled") private void createWebView() {
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        lessons=new WebView(this);lessons.setBackgroundColor(0xfff3f7f6);
        WebSettings settings=lessons.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        lessons.addJavascriptInterface(new LayoutControls(),"AndroidLayout");
        lessons.addJavascriptInterface(bridge,"HebrewLearningNative");
        lessons.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(!local(request.getUrl()) || !"GET".equals(request.getMethod()))return ContentStore.emptyResponse(403,"Forbidden",null);
                WebResourceResponse downloaded=content.intercept(request);
                if(downloaded!=null)return downloaded;
                WebResourceResponse response=loader.shouldInterceptRequest(request.getUrl());
                if(response==null)return ContentStore.emptyResponse(404,"Not Found",null);
                Map<String,String> headers=response.getResponseHeaders()==null?new HashMap<>():new HashMap<>(response.getResponseHeaders());
                headers.put("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
                headers.put("X-Content-Type-Options","nosniff");headers.put("Cache-Control","no-store");
                response.setResponseHeaders(headers);return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !local(request.getUrl());}
            @Override public void onPageFinished(WebView view,String url){if(START.equals(url)){loaded=true;checkUpdates();}}
        });
        lessons.setOnApplyWindowInsetsListener((view,insets)->{
            if(Build.VERSION.SDK_INT>=30){
                android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());
                view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
            }else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(lessons);lessons.loadUrl(START);
    }

    private static boolean local(Uri uri){return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort()==-1 && uri.getUserInfo()==null && uri.getPath()!=null && uri.getPath().startsWith("/assets/");}
    private void checkUpdates(){if(bridge!=null && !BuildConfig.UPDATE_MANIFEST_URL.isEmpty() && System.currentTimeMillis()-lastCheck>60000){lastCheck=System.currentTimeMillis();bridge.checkForUpdates();}}
    private void applyLayout(String layout){setRequestedOrientation("ktc-24".equals(layout)?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);}
    public final class LayoutControls {
        @JavascriptInterface public void setLayout(String layout){
            if(!"phone".equals(layout)&&!"ktc-24".equals(layout))return;
            runOnUiThread(()->{getPreferences(MODE_PRIVATE).edit().putString("layout",layout).apply();applyLayout(layout);});
        }
    }

    void emitNativeEvent(JSONObject detail){runOnUiThread(()->{
        if(lessons==null || isFinishing() || isDestroyed())return;
        lessons.evaluateJavascript("window.dispatchEvent(new CustomEvent('hebrew:native',{detail:"+detail+"}));",null);
        if("update-check".equals(detail.optString("event")) && "checked".equals(detail.optString("status"))){
            if(detail.optBoolean("appUpdateAvailable") && !updatePromptShown){
                updatePromptShown=true;
                new AlertDialog.Builder(this).setTitle("App update available")
                        .setMessage("Download the new version? Your stars and settings will be kept.")
                        .setPositiveButton("Download",(dialog,which)->bridge.openApkUpdate("",""))
                        .setNegativeButton("Later",null).show();
            }else if(!detail.optBoolean("appUpdateAvailable") && detail.optBoolean("contentUpdateAvailable"))bridge.downloadContent("");
        }
    });}

    void offerInstallation(File apk,String job){
        if(isFinishing()||isDestroyed())return;
        pendingApk=apk;installJob=job;
        if(!getPackageManager().canRequestPackageInstalls()){
            bridge.installationEvent(job,"permission-required");
            new AlertDialog.Builder(this).setTitle("Allow app updates")
                    .setMessage("Android needs your permission to install updates from Hebrew Learning.")
                    .setPositiveButton("Open settings",(dialog,which)->{
                        installPermission=true;
                        try{startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}
                        catch(android.content.ActivityNotFoundException error){installPermission=false;bridge.installationEvent(job,"error","error","Installation settings unavailable.");}
                    }).setNegativeButton("Cancel",(dialog,which)->bridge.installationEvent(job,"cancelled")).show();
        }else openInstaller();
    }
    private void openInstaller(){
        if(pendingApk==null || !pendingApk.isFile())return;
        Uri uri=FileProvider.getUriForFile(this,BuildConfig.APPLICATION_ID+".updates",pendingApk);
        try{startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));bridge.installationEvent(installJob,"installer-opened");}
        catch(android.content.ActivityNotFoundException|SecurityException error){bridge.installationEvent(installJob,"error","error","Android package installer unavailable.");}
    }
    @Override protected void onResume(){
        super.onResume();
        if(lessons!=null){lessons.onResume();lessons.resumeTimers();}
        if(installPermission){installPermission=false;if(getPackageManager().canRequestPackageInstalls())openInstaller();else if(bridge!=null)bridge.installationEvent(installJob,"cancelled");}
        else if(loaded)checkUpdates();
    }
    @Override protected void onPause(){
        if(lessons!=null){lessons.evaluateJavascript("window.dispatchEvent(new Event('hebrew:pause'));",null);lessons.onPause();lessons.pauseTimers();}
        super.onPause();
    }
    @SuppressWarnings("deprecation") @Override public void onBackPressed(){back();}
    private void back(){
        if(lessons==null){finish();return;}
        lessons.evaluateJavascript("(function(){const dialog=document.querySelector('dialog[open]');if(dialog){dialog.dispatchEvent(new Event('cancel',{cancelable:true}));return true;}const back=document.getElementById('back');if(!back.hidden){back.click();return true;}return false;})()",handled->{if(!"true".equals(handled))finish();});
    }
    @Override protected void onDestroy(){
        if(bridge!=null)bridge.shutdown();
        if(lessons!=null){lessons.removeJavascriptInterface("HebrewLearningNative");lessons.removeJavascriptInterface("AndroidLayout");lessons.destroy();lessons=null;}
        super.onDestroy();
    }
}
