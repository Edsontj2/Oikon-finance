package app.oikon.finance

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.security.MessageDigest

/**
 * Lê as notificações (o Android só permite depois que a pessoa autoriza nas configurações).
 * Filtra aqui mesmo, no celular: só dos apps de banco marcados e só as que têm valor em reais.
 * O resto nunca sai do aparelho.
 */
class CaptureService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            val prefs = Prefs(this)
            if (prefs.paused || !prefs.linked || sbn.packageName !in prefs.allowedApps) return
            val n = sbn.notification ?: return
            if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0 || n.flags and Notification.FLAG_ONGOING_EVENT != 0) return
            val extras = n.extras ?: return
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
            val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim()
            if (text.isNullOrEmpty()) return
            val full = "${title ?: ""} $text"
            if (!MONEY.containsMatchIn(full)) return
            val appName = Config.BANK_APPS[sbn.packageName] ?: sbn.packageName
            val captured = Captured(
                id = idFor(sbn.packageName, sbn.key, text),
                pkg = sbn.packageName,
                appName = appName,
                title = title?.take(200),
                text = text.take(1000),
                postedAt = sbn.postTime,
                status = "pendente",
                error = null,
            )
            if (Queue(this).add(captured)) UploadJob.schedule(this)
        } catch (e: Exception) {
            Prefs(this).lastError = "Erro ao ler notificação: ${e.message}"
        }
    }

    companion object {
        private val MONEY = Regex("R\\$\\s*-?\\s*\\d")

        /** Mesma notificação (mesmo app, mesma chave, mesmo texto) dá sempre o mesmo id. */
        fun idFor(pkg: String, key: String, text: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest("$pkg|$key|$text".toByteArray(Charsets.UTF_8))
            return "n_" + digest.take(16).joinToString("") { "%02x".format(it) }
        }
    }
}
