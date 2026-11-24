import com.android.build.api.dsl.ApplicationExtension

plugins { id("com.android.application") }

// Versão do app = a mesma do site (version.js). v46 → 4600, v46.1 → 4610.
val verText = rootProject.file("../version.js").readText()
val vname = Regex("RDESK_VERSION = '(v[0-9.]+)'").find(verText)!!.groupValues[1]
val vparts = vname.removePrefix("v").split(".")
val vcode = vparts[0].toInt() * 100 + (if (vparts.size > 1) vparts[1].toInt() * 10 else 0)
val ks = rootProject.file("keystore.jks")

configure<ApplicationExtension> {
    namespace = "app.rdesk.cofre"
    compileSdk {
        version = release(37) {
            minorApiLevel = 2
        }
    }

    defaultConfig {
        applicationId = "app.rdesk.cofre"
        minSdk = 24
        targetSdk = 35
        versionCode = vcode
        versionName = vname
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("projeto") {
            if (ks.exists()) {
                storeFile = ks
                storePassword = System.getenv("ANDROID_KEYSTORE_PASS")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEYSTORE_PASS")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = if (ks.exists()) signingConfigs.getByName("projeto") else signingConfigs.getByName("debug")
        }
    }
    testBuildType = "release"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    // Um APK por tipo de processador (bem menor) + um universal que roda em qualquer celular
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }
    // Bibliotecas nativas compactadas dentro do APK: download bem menor
    packaging {
        jniLibs { useLegacyPackaging = true }
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

dependencies {
    implementation("info.guardianproject:tor-android:0.4.9.17")
    implementation("androidx.localbroadcastmanager:localbroadcastmanager:1.1.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.13.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.netzarchitekten:IPtProxy:5.9.0")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
