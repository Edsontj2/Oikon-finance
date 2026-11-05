package app.oikon.finance

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Preferências do app. O token do celular fica cifrado com uma chave do Android Keystore
 * (a chave não sai do aparelho; outro app ou um backup não conseguem usar o token).
 */
class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("oikon", Context.MODE_PRIVATE)

    var paused: Boolean
        get() = sp.getBoolean("paused", false)
        set(v) = sp.edit().putBoolean("paused", v).apply()

    var allowedApps: Set<String>
        get() = sp.getStringSet("apps", emptySet()) ?: emptySet()
        set(v) = sp.edit().putStringSet("apps", HashSet(v)).apply()

    var deviceName: String
        get() = sp.getString("deviceName", null) ?: android.os.Build.MODEL ?: "Celular"
        set(v) = sp.edit().putString("deviceName", v).apply()

    var lastSync: Long
        get() = sp.getLong("lastSync", 0)
        set(v) = sp.edit().putLong("lastSync", v).apply()

    var lastError: String?
        get() = sp.getString("lastError", null)
        set(v) = sp.edit().putString("lastError", v).apply()

    var token: String?
        get() {
            val data = sp.getString("token", null) ?: return null
            val iv = sp.getString("tokenIv", null) ?: return null
            return try {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
                String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
            } catch (e: Exception) {
                null
            }
        }
        set(v) {
            if (v == null) {
                sp.edit().remove("token").remove("tokenIv").apply()
                return
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val enc = cipher.doFinal(v.toByteArray(Charsets.UTF_8))
            sp.edit()
                .putString("token", Base64.encodeToString(enc, Base64.NO_WRAP))
                .putString("tokenIv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .apply()
        }

    val linked: Boolean get() = token != null

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    companion object {
        private const val ALIAS = "oikon_device_token"
    }
}
