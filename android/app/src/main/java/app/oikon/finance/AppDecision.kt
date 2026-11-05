package app.oikon.finance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Botões "Integrar" / "Não integrar" do aviso de app novo detectado. */
class AppDecision : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pkg = intent.getStringExtra(EXTRA_PKG) ?: return
        Apps.decide(context, pkg, intent.action == ACTION_ON)
    }

    companion object {
        const val ACTION_ON = "app.oikon.finance.INTEGRAR"
        const val ACTION_OFF = "app.oikon.finance.NAO_INTEGRAR"
        const val EXTRA_PKG = "pkg"
    }
}
