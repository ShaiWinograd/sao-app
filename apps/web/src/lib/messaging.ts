/**
 * Client-side messaging helpers. These open the owner's WhatsApp / email client
 * with a pre-filled message so quotations and project updates actually reach the
 * customer, without needing a server-side delivery provider.
 */

/** Normalize an Israeli phone number to international digits for wa.me (e.g. 0501234567 -> 972501234567). */
export function normalizeIsraeliPhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

/** Build a wa.me deep link that opens WhatsApp with the message pre-filled. */
export function whatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${normalizeIsraeliPhone(phone)}?text=${encodeURIComponent(text)}`;
}

/** Build a mailto link that opens the mail client with subject and body pre-filled. */
export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Open a messaging URL. Must be called synchronously from a user gesture. */
export function openMessagingChannel(url: string): void {
  if (typeof window === 'undefined') return;
  // A synthetic anchor-click is far more reliable than window.open: browsers
  // treat it as a genuine navigation from the user gesture and don't popup-block
  // it. mailto: and tel: are handled by the OS without opening a blank tab.
  const isWeb = /^https?:/i.test(url);
  const anchor = document.createElement('a');
  anchor.href = url;
  if (isWeb) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
