plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura: com os segredos do GitHub (ANDROID_KEYSTORE_*), usa a chave de produção;
// sem eles, a chave de desenvolvimento do repositório (as atualizações instalam por cima).
val keystoreFile = System.getenv("ANDROID_KEYSTORE_FILE")

android {
    namespace = "app.oikon.finance"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.oikon.finance"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = "1.0.${System.getenv("VERSION_CODE") ?: "1"}"
    }

    signingConfigs {
        create("release") {
            if (keystoreFile != null) {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            } else {
                storeFile = file("dev.keystore")
                storePassword = "oikon-dev"
                keyAlias = "oikon"
                keyPassword = "oikon-dev"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
