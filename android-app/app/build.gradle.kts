plugins {
    id("com.android.application")
}

android {
    namespace = "org.hebrewlearning.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.hebrewlearning.app"
        minSdk = 26
        targetSdk = 35
        versionCode = providers.environmentVariable("APP_VERSION_CODE").getOrElse("1").toInt()
        versionName = providers.environmentVariable("APP_VERSION").getOrElse("0.5.1")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "UPDATE_MANIFEST_URL", "\"" + providers.environmentVariable("HEBREW_LEARNING_MANIFEST_URL").getOrElse("") + "\"")
    }

    val signingPath = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
    signingConfigs {
        if (!signingPath.isNullOrBlank()) {
            create("permanent") {
                storeFile = file(signingPath)
                storeType = providers.environmentVariable("ANDROID_KEYSTORE_TYPE").getOrElse("PKCS12")
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-test"
        }
        release {
            isMinifyEnabled = false
            if (!signingPath.isNullOrBlank()) signingConfig = signingConfigs.getByName("permanent")
        }
    }
    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.13.0")
    implementation("androidx.core:core:1.15.0")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:core:1.6.1")
}
