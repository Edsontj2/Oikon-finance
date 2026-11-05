package app.oikon.finance

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * Quais apps o OIKON lê. Qualquer app pode ser integrado: os bancos conhecidos vêm sugeridos, e
 * quando outro app avisa um valor em R$ pela primeira vez, o OIKON pergunta se é para integrar.
 * Enquanto a pessoa não decide, o que chegou desse app fica guardado só no celular.
 */
object Apps {
    const val ON = "on"
    const val OFF = "off"
    const val ASK = "ask"

    data class Entry(val pkg: String, val label: String, val state: String, val detected: Int, val known: Boolean)

    private val PACKAGE = Regex("^[A-Za-z][\\w]*(\\.[\\w]+)+$")

    fun validPackage(pkg: String) = pkg.length <= 120 && PACKAGE.matches(pkg)

    fun label(context: Context, pkg: String): String = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        Config.BANK_APPS[pkg] ?: pkg
    }

    fun isInstalled(context: Context, pkg: String): Boolean = try {
        context.packageManager.getApplicationInfo(pkg, 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    fun state(prefs: Prefs, pkg: String): String = when (pkg) {
        in prefs.allowedApps -> ON
        in prefs.deniedApps -> OFF
        else -> ASK
    }

    /** Bancos conhecidos instalados + tudo que já foi integrado, recusado ou detectado. */
    fun list(context: Context): List<Entry> {
        val prefs = Prefs(context)
        val detected = prefs.detectedApps
        val pkgs = LinkedHashSet<String>()
        Config.BANK_APPS.keys.filterTo(pkgs) { isInstalled(context, it) }
        pkgs += prefs.allowedApps
        pkgs += prefs.deniedApps
        pkgs += detected.keys
        val order = mapOf(ASK to 0, ON to 1, OFF to 2)
        return pkgs
            .map { Entry(it, label(context, it), state(prefs, it), detected[it] ?: 0, it in Config.BANK_APPS) }
            // Banco conhecido ainda sem decisão e sem nada detectado aparece como "desligado", sem pedir nada.
            .map { if (it.state == ASK && it.detected == 0) it.copy(state = OFF) else it }
            .sortedWith(compareBy<Entry>({ order[it.state] }, { it.label.lowercase() }))
    }

    /** Todos os apps abríveis do celular, para integrar um que o OIKON ainda não viu. */
    fun launchable(context: Context): List<Pair<String, String>> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        return pm.queryIntentActivities(intent, 0)
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != context.packageName }
            .distinctBy { it.first }
            .sortedBy { it.second.lowercase() }
    }

    /** A pessoa decidiu: integrar (envia o que estava guardado) ou não (apaga o guardado). */
    fun decide(context: Context, pkg: String, enabled: Boolean) {
        if (!validPackage(pkg)) return
        val prefs = Prefs(context)
        val queue = Queue(context)
        if (enabled) {
            prefs.allowedApps = prefs.allowedApps + pkg
            prefs.deniedApps = prefs.deniedApps - pkg
            queue.release(pkg)
            UploadJob.schedule(context)
        } else {
            prefs.allowedApps = prefs.allowedApps - pkg
            prefs.deniedApps = prefs.deniedApps + pkg
            queue.dropHeld(pkg)
        }
        prefs.detectedApps = prefs.detectedApps - pkg
        Alerts.cancelAsk(context, pkg)
    }

    /** Conta mais uma notificação com valor de um app não decidido. Devolve true na primeira vez. */
    fun noteDetected(context: Context, pkg: String): Boolean {
        val prefs = Prefs(context)
        val current = prefs.detectedApps
        val count = (current[pkg] ?: 0) + 1
        prefs.detectedApps = current + (pkg to count)
        return count == 1
    }
}
