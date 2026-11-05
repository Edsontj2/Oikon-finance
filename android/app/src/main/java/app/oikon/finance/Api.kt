package app.oikon.finance

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Chamadas ao OIKON (HTTPS). Rodar sempre fora da thread principal. */
object Api {
    class Result(val code: Int, val body: JSONObject?) {
        val ok get() = code in 200..299
        val message: String get() = body?.optString("error")?.takeIf { it.isNotBlank() } ?: "Erro $code"
    }

    private fun call(method: String, path: String, token: String?, payload: JSONObject?): Result {
        val conn = URL(Config.SERVER + path).openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("Accept", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (payload != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
            Result(code, try { text?.let { JSONObject(it) } } catch (e: Exception) { null })
        } finally {
            conn.disconnect()
        }
    }

    fun link(code: String, deviceName: String): Result =
        call("POST", "/api/app/vincular", null, JSONObject().put("code", code).put("deviceName", deviceName))

    fun status(token: String): Result = call("GET", "/api/app/status", token, null)

    fun upload(token: String, items: List<Captured>): Result {
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val list = JSONArray()
        for (n in items) {
            list.put(
                JSONObject()
                    .put("id", n.id)
                    .put("package", n.pkg)
                    .put("appName", n.appName)
                    .put("title", n.title ?: JSONObject.NULL)
                    .put("text", n.text)
                    .put("postedAt", iso.format(Date(n.postedAt))),
            )
        }
        return call("POST", "/api/app/notificacoes", token, JSONObject().put("notifications", list))
    }
}
