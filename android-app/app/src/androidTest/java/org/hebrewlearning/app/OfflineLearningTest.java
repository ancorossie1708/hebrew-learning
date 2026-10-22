package org.hebrewlearning.app;

import android.content.pm.ActivityInfo;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.os.SystemClock;
import android.view.MotionEvent;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.io.File;
import java.io.FileOutputStream;
import static org.junit.Assert.*;

/** Exercises the packaged app and real Android WebView, using the isolated .debug app. */
@RunWith(AndroidJUnit4.class)
public final class OfflineLearningTest {
    private ActivityScenario<MainActivity> scenario;

    private static WebView web(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group=(ViewGroup)view;
            for(int i=0;i<group.getChildCount();i++) {
                WebView found=web(group.getChildAt(i));if(found!=null)return found;
            }
        }
        return null;
    }

    private Object js(String expression) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);
        AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(activity -> {
            WebView view=web(activity.getWindow().getDecorView());
            assertNotNull(view);
            view.evaluateJavascript("(function(){try{return "+expression+";}catch(e){return 'JS_ERROR:'+e.message;}})()", value->{result.set(value);latch.countDown();});
        });
        assertTrue("WebView did not return a result",latch.await(10,TimeUnit.SECONDS));
        Object value=new JSONTokener(result.get()).nextValue();
        assertFalse(String.valueOf(value),String.valueOf(value).startsWith("JS_ERROR:"));
        return value;
    }

    private void ready() throws Exception {
        scenario.onActivity(activity -> {
            activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            activity.setTurnScreenOn(true);
            activity.setShowWhenLocked(true);
        });
        long deadline=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<deadline) {
            if(Boolean.TRUE.equals(js("document.readyState==='complete' && typeof showHome==='function'")))return;
            Thread.sleep(100);
        }
        fail("The offline lesson did not load");
    }

    private void tap(String selector) throws Exception {
        String quoted=org.json.JSONObject.quote(selector);
        js("(document.querySelector("+quoted+").scrollIntoView({block:'center'}),true)");
        Thread.sleep(200);
        org.json.JSONArray rect=(org.json.JSONArray)js("(function(){const r=document.querySelector("+quoted+").getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth];})()");
        float[] point=new float[2];
        scenario.onActivity(activity->{
            WebView view=web(activity.getWindow().getDecorView());
            int[] location=new int[2];view.getLocationOnScreen(location);
            try {float scale=(float)((view.getWidth()-view.getPaddingLeft()-view.getPaddingRight())/rect.getDouble(2));
                point[0]=location[0]+view.getPaddingLeft()+(float)rect.getDouble(0)*scale;
                point[1]=location[1]+view.getPaddingTop()+(float)rect.getDouble(1)*scale;
            } catch(Exception error){throw new AssertionError(error);}
        });
        long time=SystemClock.uptimeMillis();
        MotionEvent down=MotionEvent.obtain(time,time,MotionEvent.ACTION_DOWN,point[0],point[1],0);
        MotionEvent up=MotionEvent.obtain(time,time+80,MotionEvent.ACTION_UP,point[0],point[1],0);
        try {
            InstrumentationRegistry.getInstrumentation().sendPointerSync(down);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(up);
        } finally {down.recycle();up.recycle();}
    }

    private void screenshot(String name) throws Exception {
        File directory=InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir("acceptance");
        assertNotNull(directory);
        android.graphics.Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        try(FileOutputStream output=new FileOutputStream(new File(directory,name+".png"))){
            assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output));
        } finally {bitmap.recycle();}
    }

    @Test public void wideTabletLayoutAndImages() throws Exception {
        // The desktop runner sets 160 dpi: landscape viewport matches the target 1920x1080.
        scenario=ActivityScenario.launch(MainActivity.class);
        try {
            ready();
            js("(resetGame(),AppPreferences.set({layout:'ktc-24',showPictures:true}),showHome(),true)");
            long deadline=System.currentTimeMillis()+10000;
            while(!Boolean.TRUE.equals(js("innerWidth>=1800 && innerWidth>innerHeight")) && System.currentTimeMillis()<deadline)Thread.sleep(100);
            assertEquals("Tablet emulator must expose a wide viewport",Boolean.TRUE,js("innerWidth>=1800 && innerWidth>innerHeight"));
            assertEquals(12,((Number)js("document.querySelectorAll('.topic').length")).intValue());
            assertEquals("All twelve topics must fit the tablet screen",Boolean.TRUE,js("[...document.querySelectorAll('.topic')].every(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth;})"));
            Thread.sleep(300);screenshot("tablet-topics");
            js("(showCategory('kitchen'),showWord(0),true)");
            deadline=System.currentTimeMillis()+10000;
            while(!Boolean.TRUE.equals(js("document.querySelector('.hero').complete && document.querySelector('.hero').naturalWidth>0")) && System.currentTimeMillis()<deadline)Thread.sleep(100);
            assertEquals("Packaged WebP photo must decode offline",Boolean.TRUE,js("document.querySelector('.hero').naturalWidth>0"));
            assertEquals("Tablet lesson must have photo and text side by side",Boolean.TRUE,js("document.querySelector('.hero').getBoundingClientRect().right<=document.querySelector('.lesson-content').getBoundingClientRect().left && document.body.scrollWidth<=innerWidth"));
            Thread.sleep(500); // Allow the decoded image to reach the emulator's compositor frame.
            screenshot("tablet-lesson");
            js("(resetGame(),true)");
        } finally {if(scenario!=null)scenario.close();}
    }

    @Test public void offlineLessonsRewardsSettingsAndRestart() throws Exception {
        scenario=ActivityScenario.launch(MainActivity.class);
        try {
            ready();
            assertEquals(120,((Number)js("words.length")).intValue());
            assertEquals(12,((Number)js("categories.length")).intValue());
            assertEquals(Boolean.TRUE,js("words.every(w=>w.audioStatus==='user_verified')"));
            js("(resetGame(),true)");
            js("(showCategory('shopping'),startQuiz(),document.querySelector('.answer-select:not([data-answer=\"shopping_buy\"])').click(),true)");
            assertEquals(1,((Number)js("attempts")).intValue());
            assertEquals(2,((Number)js("document.querySelectorAll('.answer-select:not(:disabled)').length")).intValue());
            assertEquals(0,((Number)js("totalStars()")).intValue());
            assertEquals(Boolean.FALSE,js("!!document.querySelector('.option.correct')"));
            js("(document.querySelector('[data-answer=\"shopping_buy\"]').click(),true)");
            assertEquals(0,((Number)js("totalStars()")).intValue());
            js("(document.getElementById('continue').click(),document.querySelector('[data-answer=\"shopping_price\"]').click(),true)");
            assertEquals(1,((Number)js("totalStars()")).intValue());
            assertEquals(1,((Number)js("topicStars('shopping')")).intValue());

            js("(document.getElementById('settings-open').click(),AppPreferences.set({soundEnabled:false,volume:0.25,showPictures:false,layout:'ktc-24'}),true)");
            assertEquals(Boolean.TRUE,js("document.body.classList.contains('without-pictures') && document.body.classList.contains('tablet-layout')"));
            assertEquals(1,((Number)js("quizIndex")).intValue());
            AtomicReference<Integer> orientation=new AtomicReference<>();
            scenario.onActivity(a->orientation.set(a.getRequestedOrientation()));
            assertEquals(Integer.valueOf(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE),orientation.get());
            js("(closeSettings(),showHome(),true)");
            scenario.close();scenario=ActivityScenario.launch(MainActivity.class);ready();
            assertEquals(1,((Number)js("totalStars()")).intValue());
            assertEquals(2,((Number)js("done.size")).intValue());
            assertEquals("ktc-24",js("AppPreferences.get().layout"));
            assertEquals(Boolean.FALSE,js("AppPreferences.get().soundEnabled"));
            assertEquals(Boolean.FALSE,js("AppPreferences.get().showPictures"));

            js("(AppPreferences.set({soundEnabled:true,volume:0.25,layout:'phone'}),showCategory('fun'),true)");
            Thread.sleep(400);
            js("(window.tapTrace=null,document.addEventListener('click',e=>window.tapTrace={tag:e.target.tagName,play:e.target.closest('button')?.dataset.playChoice}, {once:true,capture:true}),true)");
            tap("[data-play-choice='fun_garden']");
            long deadline=System.currentTimeMillis()+15000;
            while(!Boolean.TRUE.equals(js("!!currentAudio && currentAudio.duration>0 && currentAudio.currentTime>0")) && System.currentTimeMillis()<deadline)Thread.sleep(100);
            assertEquals("A real tap must play the bundled Hebrew WAV offline: "+js("JSON.stringify({tap:tapTrace,visibility:document.visibilityState,view,settings:AppPreferences.get(),audio:currentAudio?{src:currentAudio.currentSrc,error:currentAudio.error&&currentAudio.error.code,network:currentAudio.networkState,ready:currentAudio.readyState,time:currentAudio.currentTime}:null})"),Boolean.TRUE,js("!!currentAudio && currentAudio.duration>0 && currentAudio.currentTime>0"));
            js("(resetGame(),true)");
            assertEquals(0,((Number)js("totalStars()")).intValue());
            assertEquals(0,((Number)js("done.size")).intValue());
            assertEquals("phone",js("AppPreferences.get().layout"));
            assertEquals(Boolean.TRUE,js("AppPreferences.get().soundEnabled && AppPreferences.get().showPictures"));
        } finally {if(scenario!=null)scenario.close();}
    }
}
