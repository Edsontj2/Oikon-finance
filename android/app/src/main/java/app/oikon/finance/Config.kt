package app.oikon.finance

/** Endereço do OIKON e apps de banco conhecidos (nome para mostrar na tela). */
object Config {
    const val SERVER = "https://oikon-finance.vercel.app"
    const val SMS_APP = "com.google.android.apps.messaging"

    val BANK_APPS: Map<String, String> = linkedMapOf(
        "com.nu.production" to "Nubank",
        "br.com.intermedium" to "Inter",
        "com.c6bank.app" to "C6 Bank",
        "com.itau" to "Itaú",
        "com.itau.iti" to "iti",
        "br.com.bb.android" to "Banco do Brasil",
        "com.bradesco" to "Bradesco",
        "br.com.bradesco.next" to "next",
        "com.santander.app" to "Santander",
        "br.com.gabba.Caixa" to "Caixa",
        "br.gov.caixa.tem" to "Caixa Tem",
        "com.picpay" to "PicPay",
        "com.mercadopago.wallet" to "Mercado Pago",
        "br.com.original.bank" to "Original",
        "com.btg.pactual.banking" to "BTG",
        "br.com.uol.ps.myaccount" to "PagBank",
        "com.neon" to "Neon",
        "br.com.sicoob.app" to "Sicoob",
        "br.com.sicredi.app" to "Sicredi",
        "com.google.android.apps.messaging" to "Mensagens (SMS do banco)",
    )
}
