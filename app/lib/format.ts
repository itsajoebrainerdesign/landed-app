export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// tel: link for a venue phone number. Venues carry international numbers
// from Google ("+44 20 …"); anything else is dialled as written.
export function telHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return phone.trim().startsWith("+") ? "tel:+" + digits : "tel:" + digits;
}
