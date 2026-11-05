package app.oikon.finance

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintManager
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * O OIKON inteiro dentro do app: abre o site numa WebView (login, lançamentos, cartões, relatórios…)
 * e liga a página "Notificações do banco" à leitura de notificações deste celular pela ponte [Bridge].
 * Só o endereço do OIKON abre aqui dentro; qualquer outro link vai para o navegador.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var errorView: View
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val serverHost = Uri.parse(Config.SERVER).host

    /** Lido pela ponte (outra thread): só a página do OIKON pode usar as funções do celular. */
    @Volatile var trustedPage = false
        private set

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#101114")
        window.navigationBarColor = Color.parseColor("#101114")

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#101114"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = settings.userAgentString + " OikonAndroid/" + BuildConfigLite.versionCode(this@MainActivity)
            webViewClient = Client()
            webChromeClient = Chrome()
            setDownloadListener { url, userAgent, contentDisposition, mime, _ -> download(url, userAgent, contentDisposition, mime) }
            addJavascriptInterface(Bridge(this@MainActivity), "OikonApp")
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        errorView = buildErrorView()

        setContentView(FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(errorView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(startUrl(intent))
        askNotificationPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getStringExtra(EXTRA_PATH) != null) web.loadUrl(startUrl(intent))
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // Volta das configurações do Android (permissão): a página atualiza o que mostra.
        web.evaluateJavascript("window.dispatchEvent(new Event('oikon-app'))", null)
    }

    override fun onPause() {
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Ainda é o jeito compatível com Android 8 a 12")
    override fun onBackPressed() {
        if (errorView.visibility == View.GONE && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    @Deprecated("Seletor de arquivo da importação de extrato")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            val uri = data?.data
            fileCallback?.onReceiveValue(if (resultCode == RESULT_OK && uri != null) arrayOf(uri) else null)
            fileCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    /** Chamado pela ponte: avisa a página que algo mudou no celular (vínculo, permissão…). */
    fun notifyPage(detail: String) {
        runOnUiThread {
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('oikon-app', { detail: $detail }))", null)
        }
    }

    fun printPage() {
        runOnUiThread {
            val pm = getSystemService(PrintManager::class.java) ?: return@runOnUiThread
            pm.print("OIKON", web.createPrintDocumentAdapter("OIKON"), null)
        }
    }

    private fun isOurs(uri: Uri): Boolean = uri.scheme == "https" && uri.host == serverHost

    private fun startUrl(intent: Intent?): String {
        val path = intent?.getStringExtra(EXTRA_PATH)?.takeIf { it.startsWith("/") && !it.startsWith("//") } ?: "/"
        return Config.SERVER + path
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Nenhum app abre esse link.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun download(url: String, userAgent: String, contentDisposition: String?, mime: String?) {
        val uri = Uri.parse(url)
        if (!isOurs(uri)) return openOutside(uri)
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_STORAGE)
            Toast.makeText(this, "Permita salvar arquivos e toque em exportar de novo.", Toast.LENGTH_LONG).show()
            return
        }
        try {
            val name = URLUtil.guessFileName(url, contentDisposition, mime)
            val request = DownloadManager.Request(uri)
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .addRequestHeader("User-Agent", userAgent)
                .setMimeType(mime)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            getSystemService(DownloadManager::class.java)?.enqueue(request)
            Toast.makeText(this, "Baixando $name (fica em Downloads).", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Não deu para baixar: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun askNotificationPermission() {
        // Android 13+: precisa de permissão para o OIKON avisar "nova compra para confirmar".
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
    }

    private fun buildErrorView(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.parseColor("#101114"))
        val pad = (24 * resources.displayMetrics.density).toInt()
        setPadding(pad, pad, pad, pad)
        visibility = View.GONE
        addView(TextView(context).apply {
            text = "Sem conexão com o OIKON"
            textSize = 20f
            setTextColor(Color.parseColor("#D6A457"))
            gravity = Gravity.CENTER
        })
        addView(TextView(context).apply {
            text = "Confira a internet. As notificações do banco continuam guardadas no celular e são enviadas quando a conexão voltar."
            textSize = 15f
            setTextColor(Color.parseColor("#A7ABB3"))
            gravity = Gravity.CENTER
            setPadding(0, pad / 2, 0, pad / 2)
        })
        addView(Button(context).apply {
            text = "Tentar de novo"
            setOnClickListener {
                errorView.visibility = View.GONE
                web.reload()
            }
        })
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (isOurs(uri)) return false
            openOutside(uri)
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            trustedPage = isOurs(Uri.parse(url))
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            trustedPage = isOurs(Uri.parse(url))
        }

        override fun onPageFinished(view: WebView, url: String) {
            trustedPage = isOurs(Uri.parse(url))
            CookieManager.getInstance().flush()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) errorView.visibility = View.VISIBLE
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent.createChooser(pick, "Escolha o extrato (OFX ou CSV)"), REQ_FILE)
                true
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }
    }

    companion object {
        const val EXTRA_PATH = "path"
        private const val REQ_FILE = 10
        private const val REQ_NOTIFY = 11
        private const val REQ_STORAGE = 12
    }
}

/** Versão instalada do app (vai no User-Agent para o site saber que está dentro do app). */
object BuildConfigLite {
    fun versionCode(activity: Activity): Long = try {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    } catch (e: Exception) {
        0
    }
}
