// HYPERFLEX shared utilities — load before page scripts
// <script src="/utils.js"></script>

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const ts   = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 0)         return 'just now';
  if (diff < 60)        return `${diff}s ago`;
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
