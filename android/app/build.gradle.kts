plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.trendmicro.boothapp"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.trendmicro.boothapp"
        minSdk = 33
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        // Configurable via gradle properties or CI
        buildConfigField("String", "S3_BUCKET", "\"boothapp-sessions-752266476357\"")
        buildConfigField("String", "AWS_REGION", "\"us-east-1\"")
        buildConfigField("String", "ORCHESTRATOR_URL", "\"\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // AndroidX
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("com.google.android.material:material:1.11.0")

    // CameraX
    val cameraVersion = "1.3.1"
    implementation("androidx.camera:camera-core:$cameraVersion")
    implementation("androidx.camera:camera-camera2:$cameraVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraVersion")
    implementation("androidx.camera:camera-view:$cameraVersion")

    // ML Kit Text Recognition + Barcode Scanning
    implementation("com.google.mlkit:text-recognition:16.0.0")
    implementation("com.google.mlkit:barcode-scanning:17.2.0")

    // AWS SDK for Android (S3)
    implementation("com.amazonaws:aws-android-sdk-s3:2.73.0")
    implementation("com.amazonaws:aws-android-sdk-core:2.73.0")

    // Networking (for orchestrator API)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // JSON
    implementation("com.google.code.gson:gson:2.10.1")
}
