export function getUserInitials(email?: string): string {
  if (!email) return 'U';
  const namePart = email.split('@')[0] || '';
  const parts = namePart.split(/[._-]/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second && first.length > 0 && second.length > 0) {
    return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
  }
  if (namePart.length >= 2) {
    return namePart.slice(0, 2).toUpperCase();
  }
  return (namePart[0] || 'U').toUpperCase();
}
