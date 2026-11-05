package app.oikon.finance

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/**
 * Envia a fila quando houver internet. Se falhar (sem rede, servidor fora), o Android tenta de
 * novo mais tarde. Reenviar é seguro: o servidor ignora o que já recebeu.
 */
class UploadJob : JobService() {
    @Volatile private var thread: Thread? = null

    override fun onStartJob(params: JobParameters): Boolean {
        thread = Thread {
            val retry = try { sync(this) } catch (e: Exception) {
                Prefs(this).lastError = "Falha ao enviar: ${e.message}"
                true
            }
            jobFinished(params, retry)
        }.also { it.start() }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        thread?.interrupt()
        return true
    }

    companion object {
        private const val JOB_ID = 4242

        fun schedule(context: Context) {
            val js = context.getSystemService(JobScheduler::class.java) ?: return
            val job = JobInfo.Builder(JOB_ID, ComponentName(context, UploadJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build()
            js.schedule(job)
        }

        /** Envia tudo o que está pendente. Devolve true se deve tentar de novo depois. */
        fun sync(context: Context): Boolean {
            val prefs = Prefs(context)
            val token = prefs.token ?: return false
            val queue = Queue(context)
            while (true) {
                val batch = queue.pending(50)
                if (batch.isEmpty()) break
                val result = Api.upload(token, batch)
                when {
                    result.ok -> {
                        queue.mark(batch.map { it.id }, "enviada")
                        prefs.lastSync = System.currentTimeMillis()
                        prefs.lastError = null
                    }
                    result.code == 401 -> {
                        prefs.token = null
                        prefs.lastError = "Este celular foi desvinculado no site. Vincule de novo."
                        return false
                    }
                    result.code == 423 -> {
                        prefs.lastError = "A leitura está pausada no site."
                        return false
                    }
                    result.code == 429 || result.code >= 500 -> {
                        prefs.lastError = result.message
                        return true
                    }
                    else -> {
                        queue.mark(batch.map { it.id }, "erro", result.message)
                        prefs.lastError = result.message
                    }
                }
            }
            queue.prune()
            return false
        }
    }
}
