import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { whatsappConfigured } from "@/lib/whatsapp";
import { listAccountOptions } from "@/data/accounts";
import { getLinkForUser, listMessages, maskPhone } from "@/data/assistant/link";
import { WhatsappSettings } from "./whatsapp-settings";

export default async function ConfiguracoesPage() {
  const userId = await requireUserId();
  const db = getDb();
  const [link, accounts, messages] = await Promise.all([getLinkForUser(db, userId), listAccountOptions(db, userId), listMessages(db, userId, 30)]);
  const botNumber = process.env.WHATSAPP_DISPLAY_NUMBER?.replace(/\D/g, "") || null;
  return (
    <>
      <div className="page-head">
        <h1>Configurações</h1>
      </div>
      <WhatsappSettings
        configured={whatsappConfigured()}
        botNumber={botNumber}
        link={link && { phone: maskPhone(link.phone), status: link.status, defaultAccountId: link.defaultAccountId, allowEntries: link.allowEntries, linkedAt: link.linkedAt }}
        accounts={accounts}
        messages={messages}
      />
    </>
  );
}
