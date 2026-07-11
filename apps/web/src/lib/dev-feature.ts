export function showDevFeatureNotice(featureName: string, details?: string) {
  if (typeof window === 'undefined') return;

  const message = [`${featureName} עדיין בפיתוח.`];
  if (details) {
    message.push(details);
  }
  message.push('בינתיים זהו חלון הדגמה כדי שכל הכפתורים יגיבו בצורה ברורה.');

  window.alert(message.join('\n\n'));
}
