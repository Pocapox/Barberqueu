export function isCancelCommand(text: string | null | undefined): boolean {
  return text?.trim().toUpperCase() === "CANCELAR";
}
