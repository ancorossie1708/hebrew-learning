package org.hebrewlearning.app;

import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Two separate instrumentation runs with adb install -r between them; emulator only. */
@RunWith(AndroidJUnit4.class)
public final class ProgressUpgradeTest {
    private ActivityScenario<MainActivity> scenario;
    private static WebView web(View view) {
        if(view instanceof WebView)return (WebView)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){
            WebView found=web(((ViewGroup)view).getChildAt(i));if(found!=null)return found;
        }
        return null;
    }
    private Object js(String expression) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);
        AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(activity->{
            WebView view=web(activity.getWindow().getDecorView());assertNotNull(view);
            view.evaluateJavascript("(function(){try{return "+expression+";}catch(e){return 'JS_ERROR:'+e.message;}})()",value->{result.set(value);latch.countDown();});
        });
        assertTrue(latch.await(15,TimeUnit.SECONDS));
        Object value=new JSONTokener(result.get()).nextValue();
        assertFalse(String.valueOf(value),String.valueOf(value).startsWith("JS_ERROR:"));return value;
    }
    private void open() throws Exception {
        scenario=ActivityScenario.launch(MainActivity.class);
        scenario.onActivity(a->{a.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);a.setTurnScreenOn(true);a.setShowWhenLocked(true);});
        long deadline=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<deadline){
            if(Boolean.TRUE.equals(js("document.readyState==='complete' && typeof totalStars==='function'")))return;
            Thread.sleep(100);
        }
        fail("App did not load");
    }
    private void assertSaved(int count) throws Exception {
        assertEquals(count,((Number)js("words.length")).intValue());
        assertEquals(68,((Number)js("totalStars()")).intValue());
        assertEquals(92,((Number)js("done.size")).intValue());
        assertEquals(68,((Number)js("categories.reduce((sum,c)=>sum+topicStars(c.id),0)")).intValue());
        assertEquals(Boolean.FALSE,js("AppPreferences.get().soundEnabled"));
        assertEquals(0.25,((Number)js("AppPreferences.get().volume")).doubleValue(),0.0001);
        assertEquals(Boolean.FALSE,js("AppPreferences.get().showPictures"));
        assertEquals("ktc-24",js("AppPreferences.get().layout"));
    }
    @Test public void progressAcrossApkReplacement() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("upgradePhase","");
        int expandedCount=Integer.parseInt(InstrumentationRegistry.getArguments().getString("upgradeWordCount","160"));
        Assume.assumeTrue("Two-phase emulator upgrade test only",phase.equals("seed")||phase.equals("verify"));
        assertTrue("Physical devices are forbidden",Build.HARDWARE.contains("ranchu")||Build.HARDWARE.contains("goldfish"));
        try {
            open();
            if(phase.equals("seed")){
                assertEquals(120,((Number)js("words.length")).intValue());
                js("(function(){resetGame();AppPreferences.set({soundEnabled:false});for(let i=0;i<92;i++){const w=words[i];showCategory(w.categoryId);showQuiz(byCategory(w.categoryId).findIndex(x=>x.id===w.id));if(i>=68)document.querySelector('.answer-select:not([data-answer=\"'+w.id+'\"])').click();document.querySelector('[data-answer=\"'+w.id+'\"]').click();MilestoneRewards.dismiss();}AppPreferences.set({soundEnabled:false,volume:0.25,showPictures:false,layout:'ktc-24'});showHome();save();localStorage.removeItem('hebrew-learning-star-reset-version');return true;})()");
                assertSaved(120);
            }else{
                assertSaved(expandedCount);
                assertEquals(92,((Number)js("practisedCount()")).intValue());
                assertEquals(Boolean.TRUE,js("document.getElementById('main').textContent.includes('92 of "+expandedCount+"')"));
                assertEquals(Boolean.TRUE,js("MilestoneRewards.markup(totalStars()).includes('"+(expandedCount-10)+" stars: not yet earned')"));
                // A second fresh process/activity must read the same records, not in-memory state.
                scenario.close();open();assertSaved(expandedCount);
                String newWord=InstrumentationRegistry.getArguments().getString("upgradeWordId","upgrade_fixture_topic_0_word_0");
                js("(function(){const id="+JSONObject.quote(newWord)+";const w=words.find(x=>x.id===id);showCategory(w.categoryId);showQuiz(byCategory(w.categoryId).findIndex(x=>x.id===id));document.querySelector('[data-answer=\"'+id+'\"]').click();MilestoneRewards.dismiss();return true;})()");
                assertEquals(69,((Number)js("totalStars()")).intValue());
                assertEquals(93,((Number)js("practisedCount()")).intValue());
                scenario.close();open();
                assertEquals(69,((Number)js("totalStars()")).intValue());
                assertEquals(93,((Number)js("practisedCount()")).intValue());
            }
            JSONObject evidence=new JSONObject();
            evidence.put("phase",phase).put("words",js("words.length")).put("stars",js("totalStars()"))
                    .put("practised",js("done.size")).put("settings",new JSONObject((String)js("JSON.stringify(AppPreferences.get())")));
            android.content.Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();
            evidence.put("dataDirectory",target.getDataDir().getAbsolutePath()).put("applicationUid",target.getApplicationInfo().uid)
                    .put("versionCode",target.getPackageManager().getPackageInfo(target.getPackageName(),0).versionCode);
            File folder=target.getExternalFilesDir("progress-upgrade");assertNotNull(folder);
            try(FileOutputStream out=new FileOutputStream(new File(folder,phase+".json"))){out.write(evidence.toString(2).getBytes(StandardCharsets.UTF_8));}
        }finally{if(scenario!=null)scenario.close();}
    }
}
