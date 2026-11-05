package app.oikon.finance

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/** Aviso do próprio OIKON: "chegaram movimentações para confirmar". Tocar abre a página certa no app. */
object Alerts {
    private const val CHANNEL = "para_confirmar"
    private const val ID = 7001

    fun newPending(context: Context, count: Int) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (!nm.areNotificationsEnabled()) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Movimentações para confirmar", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Avisa quando uma compra ou Pix do banco chegou ao OIKON e espera sua confirmação."
            },
        )
        val open = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_PATH, "/notificacoes")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val text = if (count == 1) "1 movimentação do banco para confirmar." else "$count movimentações do banco para confirmar."
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_oikon)
            .setContentTitle("OIKON")
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        try {
            nm.notify(ID, notification)
        } catch (e: SecurityException) {
            // Sem permissão de notificação (Android 13+): a pessoa vê ao abrir o app.
        }
    }
}
