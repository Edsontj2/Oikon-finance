package app.oikon.finance

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.security.MessageDigest

/**
 * Lê as notificações (o Android só permite depois que a pessoa autoriza nas configurações).
 * Filtra aqui mesmo, no celular: só as que têm valor em reais, e só dos apps que a pessoa integrou.
 * App novo que avisa valor: o OIKON pergunta se é para integrar e, até a resposta, guarda só no
 * celular. App recusado: nada dele é guardado. O resto nunca sai do aparelho.
 */
class CaptureService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            val prefs = Prefs(this)
            val pkg = sbn.packageName
            if (prefs.paused || !prefs.linked || pkg == packageName || pkg in prefs.deniedApps) return
            val n = sbn.notification ?: return
            if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0 || n.flags and Notification.FLAG_ONGOING_EVENT != 0) return
            val extras = n.extras ?: return
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
            val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim()
            if (text.isNullOrEmpty()) return
            val full = "${title ?: ""} $text"
            if (!MONEY.containsMatchIn(full)) return
            val integrated = pkg in prefs.allowedApps
            val appName = Apps.label(this, pkg)
            val captured = Captured(
                id = idFor(pkg, sbn.key, text),
                pkg = pkg,
                appName = appName,
                title = title?.take(200),
                text = text.take(1000),
                postedAt = sbn.postTime,
                status = if (integrated) "pendente" else HELD,
                error = null,
            )
            val added = Queue(this).add(captured)
            if (!added) return
            if (integrated) UploadJob.schedule(this)
            else if (Apps.noteDetected(this, pkg)) Alerts.askApp(this, pkg, appName)
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
