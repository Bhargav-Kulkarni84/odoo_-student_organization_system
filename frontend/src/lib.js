const API_BASE = import.meta.env.DEV ? 'http://localhost:3000/api/v1' : '/api/v1';
export async function request(path, options = {}) {
  const token = localStorage.getItem('gather_token');
  const response = await fetch(`${API_BASE}${path}`, { headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }, ...options });
  if (response.status === 401) { localStorage.removeItem('gather_user'); localStorage.removeItem('gather_token'); window.dispatchEvent(new Event('gather:unauthorized')); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const detail = Array.isArray(payload.errors) ? payload.errors.map((item) => item.message).filter(Boolean).join(' ') : ''; throw new Error([payload.message, detail].filter(Boolean).join(': ') || 'Something went wrong. Please try again.'); }
  return payload;
}
export const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
export const timeLabel = (value) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
export const money = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'INR' });
export const emptyEvent = { title: '', description: '', location: '', starts_at: '', ends_at: '', ticket_name: 'General Admission', member_price: 0, non_member_price: 0, quantity_available: 50 };
export const apiList = (payload, key) => payload?.[key] || payload?.data || [];
export const benefitsLabel = (benefits) => typeof benefits === 'string' ? benefits : benefits ? Object.entries(benefits).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`).join(' � ') : 'Member discounts and access to club activities.';
export const announcementBody = (body) => { const value = String(body || ''); return /(?:error:|severity:\s*["']fatal|code:\s*["']53300|at process\.)/i.test(value) ? 'This announcement is temporarily unavailable. Please contact the campus team.' : value; };
