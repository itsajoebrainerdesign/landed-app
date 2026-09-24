export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// tel: link for a venue phone number. Live venues carry international
// numbers ("+44 20 …"); the static Galway catalog uses Irish national
// format ("091 …"), which gets +353 in place of the leading 0.
export function telHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return "tel:+" + digits;
  return "tel:+353" + digits.slice(1);
}
