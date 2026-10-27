"use client";

import { useState } from "react";
import { formatMoney, parseMoney } from "@/lib/money";

/** Campo de valor em reais que mostra como o valor foi entendido (ex.: "1.234" = R$ 1.234,00). */
export function MoneyInput({
  name,
  label,
  defaultCents,
  required = false,
  allowNegative = false,
  placeholder = "0,00",
  hint,
}: {
  name: string;
  label: string;
  defaultCents?: number | null;
  required?: boolean;
  allowNegative?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const [text, setText] = useState(defaultCents ? formatMoney(defaultCents).replace(/[^\d,.-]/g, "") : "");
  const cents = text.trim() ? parseMoney(text) : null;
  const invalid = text.trim() !== "" && (cents === null || (!allowNegative && cents < 0));
  return (
    <label>
      {label}
      <input
        name={name}
        inputMode={allowNegative ? "text" : "decimal"}
        autoComplete="off"
        placeholder={placeholder}
        required={required}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={invalid}
      />
      <span className={invalid ? "hint hint-error" : "hint"}>
        {invalid ? "Valor inválido. Exemplo: 1.234,56" : cents !== null ? `= ${formatMoney(cents)}` : hint ?? " "}
      </span>
    </label>
  );
}
