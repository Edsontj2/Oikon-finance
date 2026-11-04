import { invoiceStatusLabel, type InvoiceStatus } from "@/domain/cards";

const tone: Record<InvoiceStatus, string> = {
  open: "tag-installment",
  future: "tag-installment",
  closed: "tag-pending",
  partial: "tag-late",
  overdue: "tag-late",
  paid: "tag-ok",
  paid_late: "tag-ok",
  installed: "tag-ok",
  empty: "tag-installment",
};

export function InvoiceStatusTag({ status }: { status: InvoiceStatus }) {
  return <span className={`tag ${tone[status]}`}>{invoiceStatusLabel[status]}</span>;
}
