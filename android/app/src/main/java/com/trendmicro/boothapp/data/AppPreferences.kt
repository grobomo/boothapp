package com.trendmicro.boothapp.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persists app configuration: orchestrator URL, default demo PC, SE name, AWS creds.
 * AWS credentials stored in EncryptedSharedPreferences when available, falls back to regular prefs.
 */
class AppPreferences(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("boothapp_prefs", Context.MODE_PRIVATE)

    private val securePrefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "boothapp_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (_: Exception) {
        prefs // fallback
    }

    var orchestratorUrl: String
        get() = prefs.getString(KEY_ORCHESTRATOR_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_ORCHESTRATOR_URL, value.trimEnd('/')).apply()

    var defaultDemoPc: String
        get() = prefs.getString(KEY_DEMO_PC, "booth-pc-1") ?: "booth-pc-1"
        set(value) = prefs.edit().putString(KEY_DEMO_PC, value).apply()

    var defaultSeName: String
        get() = prefs.getString(KEY_SE_NAME, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SE_NAME, value).apply()

    var awsAccessKeyId: String
        get() = securePrefs.getString(KEY_AWS_ACCESS_KEY, "") ?: ""
        set(value) = securePrefs.edit().putString(KEY_AWS_ACCESS_KEY, value).apply()

    var awsSecretAccessKey: String
        get() = securePrefs.getString(KEY_AWS_SECRET_KEY, "") ?: ""
        set(value) = securePrefs.edit().putString(KEY_AWS_SECRET_KEY, value).apply()

    var eventId: Int
        get() = prefs.getInt(KEY_EVENT_ID, 0)
        set(value) = prefs.edit().putInt(KEY_EVENT_ID, value).apply()

    var eventName: String
        get() = prefs.getString(KEY_EVENT_NAME, "") ?: ""
        set(value) = prefs.edit().putString(KEY_EVENT_NAME, value).apply()

    var badgeFields: String
        get() = prefs.getString(KEY_BADGE_FIELDS, "name,company,title") ?: "name,company,title"
        set(value) = prefs.edit().putString(KEY_BADGE_FIELDS, value).apply()

    fun hasAwsCredentials(): Boolean =
        awsAccessKeyId.isNotBlank() && awsSecretAccessKey.isNotBlank()

    companion object {
        private const val KEY_ORCHESTRATOR_URL = "orchestrator_url"
        private const val KEY_DEMO_PC = "default_demo_pc"
        private const val KEY_SE_NAME = "default_se_name"
        private const val KEY_AWS_ACCESS_KEY = "aws_access_key_id"
        private const val KEY_AWS_SECRET_KEY = "aws_secret_access_key"
        private const val KEY_EVENT_ID = "event_id"
        private const val KEY_EVENT_NAME = "event_name"
        private const val KEY_BADGE_FIELDS = "badge_fields"
    }
}
