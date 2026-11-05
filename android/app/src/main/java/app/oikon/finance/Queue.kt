package app.oikon.finance

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Notificação guardada no celular até ser enviada (fila para quando estiver sem internet). */
data class Captured(
    val id: String,
    val pkg: String,
    val appName: String,
    val title: String?,
    val text: String,
    val postedAt: Long,
    val status: String,
    val error: String?,
)

/** Status de quem veio de um app ainda não decidido: fica só no celular até a pessoa escolher. */
const val HELD = "retida"

class Queue(context: Context) : SQLiteOpenHelper(context.applicationContext, "fila.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE fila (
                 id TEXT PRIMARY KEY, pkg TEXT NOT NULL, app_name TEXT NOT NULL, title TEXT, text TEXT NOT NULL,
                 posted_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', attempts INTEGER NOT NULL DEFAULT 0,
                 error TEXT, created_at INTEGER NOT NULL)""",
        )
        db.execSQL("CREATE INDEX fila_status ON fila (status, posted_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    /** Guarda; a mesma notificação (mesmo id) não entra duas vezes. Devolve true se entrou. */
    fun add(item: Captured): Boolean {
        val values = ContentValues().apply {
            put("id", item.id)
            put("pkg", item.pkg)
            put("app_name", item.appName)
            put("title", item.title)
            put("text", item.text)
            put("posted_at", item.postedAt)
            put("status", item.status)
            put("created_at", System.currentTimeMillis())
        }
        return writableDatabase.insertWithOnConflict("fila", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    fun pending(limit: Int): List<Captured> = query("status = 'pendente'", "posted_at ASC", limit)

    fun recent(limit: Int): List<Captured> = query(null, "posted_at DESC", limit)

    fun countPending(): Int =
        readableDatabase.rawQuery("SELECT count(*) FROM fila WHERE status = 'pendente'", null).use { c -> if (c.moveToFirst()) c.getInt(0) else 0 }

    /** Notificações de um app que ainda espera a decisão da pessoa: passam a ser enviadas. */
    fun release(pkg: String) {
        writableDatabase.execSQL("UPDATE fila SET status = 'pendente' WHERE pkg = ? AND status = '$HELD'", arrayOf(pkg))
    }

    /** A pessoa não quis integrar o app: o que estava guardado dele é apagado do celular. */
    fun dropHeld(pkg: String) {
        writableDatabase.execSQL("DELETE FROM fila WHERE pkg = ? AND status = '$HELD'", arrayOf(pkg))
    }

    fun mark(ids: List<String>, status: String, error: String? = null) {
        if (ids.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) {
                db.execSQL("UPDATE fila SET status = ?, error = ?, attempts = attempts + 1 WHERE id = ?", arrayOf(status, error, id))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** Limpa enviadas com mais de 30 dias (o histórico fica no site) e as não decididas com mais de 7. */
    fun prune() {
        val now = System.currentTimeMillis()
        writableDatabase.execSQL("DELETE FROM fila WHERE status NOT IN ('pendente', '$HELD') AND posted_at < ?", arrayOf(now - 30L * 24 * 3600 * 1000))
        writableDatabase.execSQL("DELETE FROM fila WHERE status = '$HELD' AND posted_at < ?", arrayOf(now - 7L * 24 * 3600 * 1000))
    }

    private fun query(where: String?, order: String, limit: Int): List<Captured> {
        val out = ArrayList<Captured>()
        readableDatabase.query("fila", null, where, null, null, null, order, limit.toString()).use { c ->
            while (c.moveToNext()) {
                out.add(
                    Captured(
                        id = c.getString(c.getColumnIndexOrThrow("id")),
                        pkg = c.getString(c.getColumnIndexOrThrow("pkg")),
                        appName = c.getString(c.getColumnIndexOrThrow("app_name")),
                        title = c.getString(c.getColumnIndexOrThrow("title")),
                        text = c.getString(c.getColumnIndexOrThrow("text")),
                        postedAt = c.getLong(c.getColumnIndexOrThrow("posted_at")),
                        status = c.getString(c.getColumnIndexOrThrow("status")),
                        error = c.getString(c.getColumnIndexOrThrow("error")),
                    ),
                )
            }
        }
        return out
    }
}
