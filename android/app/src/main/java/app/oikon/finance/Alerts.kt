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
    private const val CHANNEL_APPS = "apps_novos"
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
        show(nm, ID, notification)
    }

    /** "O app X avisou um valor em R$. Integrar ao OIKON?" com os dois botões. */
    fun askApp(context: Context, pkg: String, label: String) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (!nm.areNotificationsEnabled()) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_APPS, "Apps novos com valores", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Pergunta se um app que avisou valores em R$ deve ser integrado ao OIKON."
            },
        )
        val id = idFor(pkg)
        fun decision(action: String) = PendingIntent.getBroadcast(
            context, id + if (action == AppDecision.ACTION_ON) 1 else 2,
            Intent(context, AppDecision::class.java).setAction(action).putExtra(AppDecision.EXTRA_PKG, pkg),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val open = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_PATH, "/notificacoes")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val notification = Notification.Builder(context, CHANNEL_APPS)
            .setSmallIcon(R.drawable.ic_stat_oikon)
            .setContentTitle("Integrar $label ao OIKON?")
            .setContentText("$label avisou um valor em R$. Integrando, as movimentações dele chegam para você confirmar.")
            .setStyle(Notification.BigTextStyle().bigText("$label avisou um valor em R$. Integrando, as movimentações dele chegam ao OIKON para você confirmar. Se não integrar, nada dele sai do celular."))
            .setContentIntent(PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .addAction(Notification.Action.Builder(null, "Integrar", decision(AppDecision.ACTION_ON)).build())
            .addAction(Notification.Action.Builder(null, "Não integrar", decision(AppDecision.ACTION_OFF)).build())
            .setAutoCancel(true)
            .build()
        show(nm, id, notification)
    }

    fun cancelAsk(context: Context, pkg: String) {
        context.getSystemService(NotificationManager::class.java)?.cancel(idFor(pkg))
    }

    private fun idFor(pkg: String) = 8000 + (pkg.hashCode() and 0xffff) * 4

    private fun show(nm: NotificationManager, id: Int, notification: Notification) {
        try {
            nm.notify(id, notification)
        } catch (e: SecurityException) {
            // Sem permissão de notificação (Android 13+): a pessoa vê ao abrir o app.
        }
    }
}
