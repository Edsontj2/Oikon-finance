package app.oikon.finance

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * Funções do celular que a página do OIKON chama como `window.OikonApp.*`.
 * Cada chamada confere que a página aberta é mesmo o OIKON; outra página não consegue usar nada.
 * O vínculo usa o mesmo código de uso único do site, gerado pela sessão de quem está logado.
 */
class Bridge(private val activity: MainActivity) {
    private val prefs = Prefs(activity)

    private fun allowed() = activity.trustedPage

    /** Situação da leitura neste celular, em JSON. */
    @JavascriptInterface
    fun info(): String {
        if (!allowed()) return "{}"
        val apps = JSONArray()
        for (a in Apps.list(activity)) {
            apps.put(
                JSONObject().put("pkg", a.pkg).put("label", a.label).put("state", a.state)
                    .put("allowed", a.state == Apps.ON).put("detected", a.detected).put("known", a.known),
            )
        }
        return JSONObject()
            .put("linked", prefs.linked)
            .put("deviceName", prefs.deviceName)
            .put("listener", listenerEnabled())
            .put("paused", prefs.paused)
            .put("pending", Queue(activity).countPending())
            .put("lastSync", prefs.lastSync)
            .put("lastError", prefs.lastError ?: JSONObject.NULL)
            .put("apps", apps)
            .toString()
    }

    /** Vincula este celular com um código gerado agora pela página. A resposta chega pelo evento "oikon-app". */
    @JavascriptInterface
    fun link(code: String) {
        if (!allowed()) return
        val digits = code.filter { it.isDigit() }
        Thread {
            val name = android.os.Build.MODEL ?: "Celular"
            val result = try { Api.link(digits, name) } catch (e: Exception) { null }
            val token = result?.body?.optString("token").orEmpty()
            val detail = JSONObject()
            if (result != null && result.ok && token.isNotEmpty()) {
                prefs.token = token
                prefs.deviceName = name
                prefs.lastError = null
                detail.put("linked", true)
                // Começa com os apps de banco instalados marcados (dá para desmarcar). SMS fica de fora até a pessoa marcar.
                if (prefs.allowedApps.isEmpty()) prefs.allowedApps = Config.BANK_APPS.keys.filter { it != Config.SMS_APP && Apps.isInstalled(activity, it) }.toSet()
            } else {
                detail.put("linked", false).put("error", result?.message ?: "Sem conexão com o OIKON. Tente de novo.")
            }
            activity.notifyPage(detail.toString())
        }.start()
    }

    @JavascriptInterface
    fun unlink() {
        if (!allowed()) return
        prefs.token = null
        activity.notifyPage("{}")
    }

    /** Integrar (true) ou não (false) um app. Vale para qualquer app, não só bancos conhecidos. */
    @JavascriptInterface
    fun setApp(pkg: String, enabled: Boolean) {
        if (!allowed() || !Apps.validPackage(pkg)) return
        Apps.decide(activity, pkg, enabled)
    }

    /** Todos os apps do celular (nome e pacote), para integrar um que ainda não apareceu. */
    @JavascriptInterface
    fun allApps(): String {
        if (!allowed()) return "[]"
        val out = JSONArray()
        for ((pkg, label) in Apps.launchable(activity)) out.put(JSONObject().put("pkg", pkg).put("label", label))
        return out.toString()
    }

    @JavascriptInterface
    fun setPaused(paused: Boolean) {
        if (!allowed()) return
        prefs.paused = paused
    }

    /** Abre a tela do Android onde se permite o acesso às notificações. */
    @JavascriptInterface
    fun openNotificationAccess() {
        if (!allowed()) return
        activity.runOnUiThread { activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
    }

    /** Ajustes nativos (lista do que foi captado, enviar agora). */
    @JavascriptInterface
    fun openSetup() {
        if (!allowed()) return
        activity.runOnUiThread { activity.startActivity(Intent(activity, SetupActivity::class.java)) }
    }

    @JavascriptInterface
    fun syncNow() {
        if (!allowed()) return
        Thread {
            val retry = try { UploadJob.sync(activity) } catch (e: Exception) { prefs.lastError = "Falha ao enviar: ${e.message}"; true }
            if (retry) UploadJob.schedule(activity)
            activity.notifyPage("{\"synced\":true}")
        }.start()
    }

    /** Imprimir / salvar em PDF (o window.print() não funciona dentro do app). */
    @JavascriptInterface
    fun print() {
        if (!allowed()) return
        activity.printPage()
    }

    private fun listenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(activity.contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(activity, CaptureService::class.java).flattenToString()
        return flat.split(":").any { it == me }
    }
}
