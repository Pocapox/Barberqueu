/** Returns international digits suitable for storage and WhatsApp JIDs. */
export function normalizePhone(input: string, defaultCountryCode = "1"): string {
  if (!/^[1-9]\d{0,2}$/.test(defaultCountryCode)) {
    throw new Error("Código de país inválido.");
  }

  const trimmed = input.trim();
  if (!trimmed || !/^\+?[\d ().-]+$/.test(trimmed)) {
    throw new Error("Introduce un teléfono válido, sin extensiones.");
  }

  const compact = trimmed.replace(/[ ().-]/g, "");
  const international = compact.startsWith("+") || compact.startsWith("00");
  let digits = compact.replace(/^(\+|00)/, "");

  if (!international) {
    if (defaultCountryCode === "1") {
      if (digits.length === 10) digits = `1${digits}`;
      else if (digits.length !== 11 || !digits.startsWith("1")) {
        throw new Error("Usa 10 dígitos locales o el prefijo internacional +.");
      }
    } else {
      digits = `${defaultCountryCode}${digits}`;
    }
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error("El teléfono debe tener entre 8 y 15 dígitos internacionales.");
  }

  if (digits.startsWith("1") && !/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    throw new Error("Número inválido para el código de país 1.");
  }

  return digits;
}
