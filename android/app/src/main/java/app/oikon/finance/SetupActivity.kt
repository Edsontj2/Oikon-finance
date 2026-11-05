package app.oikon.finance

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.text.DateFormat
import java.util.Date

/** Tela nativa de ajustes da leitura (reserva: o normal é ativar tudo pelo próprio OIKON, em Notificações do banco). */
class SetupActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var root: LinearLayout

    private val gold = Color.parseColor("#D6A457")
    private val muted = Color.parseColor("#A7ABB3")
    private val bad = Color.parseColor("#EF4444")
    private val good = Color.parseColor("#2ECC71")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(20)
            setPadding(p, dp(28), p, dp(40))
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#101114"))
            addView(root)
        })
    }

    override fun onResume() {
        super.onResume()
        render()
        if (prefs.linked) checkStatus()
    }

    private fun render() {
        root.removeAllViews()
        title("Leitura de notificações")
        text("Lê as notificações dos seus apps de banco e manda para o OIKON. Você confirma cada uma em Notificações do banco antes de virar lançamento.", muted)

        section("1. Vincular ao seu OIKON")
        if (prefs.linked) {
            text("Vinculado como \"${prefs.deviceName}\".", good)
            button("Desvincular este celular") {
                prefs.token = null
                Toast.makeText(this, "Desvinculado. Desvincule também no site, se quiser.", Toast.LENGTH_LONG).show()
                render()
            }
        } else {
            text("O jeito fácil: no OIKON, abra Mais → Notificações do banco e toque em \"Ativar neste celular\". Ou digite aqui um código de vínculo gerado no site:", muted)
            val code = EditText(this).apply {
                inputType = InputType.TYPE_CLASS_NUMBER
                filters = arrayOf(InputFilter.LengthFilter(9))
                hint = "Código de 8 dígitos"
                setTextColor(Color.WHITE)
                setHintTextColor(muted)
                textSize = 22f
                gravity = Gravity.CENTER
            }
            root.addView(code)
            button("Vincular") { link(code.text.toString().filter { it.isDigit() }) }
        }

        section("2. Permitir ler notificações")
        if (listenerEnabled()) {
            text("Acesso às notificações: permitido.", good)
        } else {
            text("Acesso às notificações: ainda não permitido. Toque abaixo, ache \"OIKON\" e ative.", bad)
        }
        button(if (listenerEnabled()) "Abrir a configuração de acesso" else "Permitir acesso às notificações") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        section("3. Apps que o OIKON pode ler")
        text("Qualquer app pode ser integrado. Quando um app novo avisa um valor em R$, o OIKON pergunta. Só as notificações com valor dos apps marcados saem do celular.", muted)
        val apps = Apps.list(this)
        if (apps.isEmpty()) text("Nenhum app ainda. Assim que um app avisar um valor, ele aparece aqui.", muted)
        for (a in apps) {
            root.addView(CheckBox(this).apply {
                text = if (a.state == Apps.ASK) "${a.label} (novo: ${a.detected} com valor, esperando você decidir)" else a.label
                setTextColor(Color.WHITE)
                isChecked = a.state == Apps.ON
                setOnCheckedChangeListener { _, checked -> Apps.decide(this@SetupActivity, a.pkg, checked) }
            })
        }

        section("4. Situação")
        root.addView(Switch(this).apply {
            text = "Pausar a leitura"
            setTextColor(Color.WHITE)
            isChecked = prefs.paused
            setOnCheckedChangeListener { _, checked -> prefs.paused = checked }
        })
        val queue = Queue(this)
        val pending = queue.countPending()
        text(
            buildString {
                append(if (pending == 0) "Nada esperando envio." else "$pending esperando envio (sai quando houver internet).")
                if (prefs.lastSync > 0) append("\nÚltimo envio: ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(prefs.lastSync))}")
            },
            muted,
        )
        prefs.lastError?.let { text(it, bad) }
        if (prefs.linked) button("Enviar agora") { syncNow() }

        section("Últimas notificações captadas")
        val recent = queue.recent(20)
        if (recent.isEmpty()) text("Nenhuma ainda.", muted)
        for (n in recent) {
            val status = when (n.status) {
                "enviada" -> "enviada"
                "erro" -> "erro: ${n.error ?: ""}"
                HELD -> "esperando você decidir se integra o app"
                else -> "esperando envio"
            }
            text("${n.appName} · ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(n.postedAt))} · $status\n${n.title?.let { "$it: " } ?: ""}${n.text}", if (n.status == "erro") bad else Color.WHITE, small = true)
        }
    }

    private fun link(code: String) {
        if (code.length != 8) {
            Toast.makeText(this, "O código tem 8 dígitos.", Toast.LENGTH_SHORT).show()
            return
        }
        Thread {
            val result = try { Api.link(code, android.os.Build.MODEL ?: "Celular") } catch (e: Exception) { null }
            runOnUiThread {
                when {
                    result == null -> Toast.makeText(this, "Sem conexão com o OIKON. Tente de novo.", Toast.LENGTH_LONG).show()
                    result.ok && result.body?.optString("token").isNullOrEmpty().not() -> {
                        prefs.token = result.body!!.getString("token")
                        prefs.deviceName = android.os.Build.MODEL ?: "Celular"
                        prefs.lastError = null
                        Toast.makeText(this, "Celular vinculado!", Toast.LENGTH_LONG).show()
                        render()
                    }
                    else -> Toast.makeText(this, result.message, Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun checkStatus() {
        val token = prefs.token ?: return
        Thread {
            val result = try { Api.status(token) } catch (e: Exception) { null } ?: return@Thread
            runOnUiThread {
                if (result.code == 401) {
                    prefs.token = null
                    prefs.lastError = "Este celular foi desvinculado no site. Vincule de novo."
                    render()
                } else if (result.ok && result.body?.optBoolean("paused") == true) {
                    prefs.lastError = "A leitura está pausada no site."
                    render()
                }
            }
        }.start()
    }

    private fun syncNow() {
        Thread {
            val retry = try { UploadJob.sync(this) } catch (e: Exception) { prefs.lastError = "Falha ao enviar: ${e.message}"; true }
            if (retry) UploadJob.schedule(this)
            runOnUiThread { render() }
        }.start()
    }

    private fun listenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(this, CaptureService::class.java).flattenToString()
        return flat.split(":").any { it == me }
    }

    // ---- pequenos ajudantes de tela ----
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun title(s: String) = root.addView(TextView(this).apply {
        text = s
        textSize = 28f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(gold)
    })

    private fun section(s: String) = root.addView(TextView(this).apply {
        text = s
        textSize = 17f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.WHITE)
        setPadding(0, dp(24), 0, dp(6))
    })

    private fun text(s: String, color: Int, small: Boolean = false) = root.addView(TextView(this).apply {
        text = s
        textSize = if (small) 13f else 15f
        setTextColor(color)
        setPadding(0, dp(4), 0, dp(4))
    })

    private fun button(label: String, onClick: (View) -> Unit) = root.addView(Button(this).apply {
        text = label
        setOnClickListener(onClick)
    })
}
