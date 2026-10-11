import React, { useEffect, useState } from 'react';
import { dateLabel, request, timeLabel } from '../lib.js';

export function EventModal({ event, user, onClose, onLogin, onToast }) {
  return <div className="modal-backdrop" onClick={(click) => click.target === click.currentTarget && onClose()}><section className="event-detail-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}>Close</button><span className="detail-eyebrow">EVENT DETAILS</span><h2>{event.title}</h2><div className="detail-meta"><span>{event.club_name || 'Independent event'}</span><span>{dateLabel(event.starts_at)}</span><span>{event.location || 'Location not provided'}</span></div><p id="event-detail-description">{event.description || 'No description was provided for this event.'}</p><TicketBooking event={event} user={user} onLogin={onLogin} onToast={onToast} /><div className="detail-actions"><button className="link-button" onClick={onClose}>Close</button></div></section></div>;
}

export function TicketBooking({ event, user, onLogin, onToast }) {
  const [ticket, setTicket] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ticketError, setTicketError] = useState('');
  const loadTicket = () => {
    setLoading(true);
    return request(`/events/${event.id}/ticket-types`)
      .then((types) => { setTicket(Array.isArray(types) ? types[0] : types.data?.[0] || null); setTicketError(''); })
      .catch((error) => { setTicket(null); setTicketError(error.message); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadTicket(); }, [event.id]);
  if (loading) return <div className="ticket-booking"><strong>Loading ticket options...</strong></div>;
  if (ticketError) return <div className="ticket-booking"><strong>Ticket booking unavailable</strong><small>{ticketError}</small></div>;
  if (!ticket) return <div className="ticket-booking"><strong>Tickets are not available for this event.</strong><small>The organizer has not opened ticket sales yet.</small></div>;
  const unitPrice = ticket.is_member ? Number(ticket.member_price) : Number(ticket.non_member_price);
  const book = async () => {
    if (!user) return onLogin();
    try {
      const response = await request('/ticket-orders', { method: 'POST', body: JSON.stringify({ ticket_type_id: Number(ticket.id), quantity: Number(quantity) }) });
      setBooking(response);
      await loadTicket();
      onToast(response.receipt?.status === 'stored' ? 'Tickets reserved and receipt stored securely.' : 'Tickets reserved. Receipt storage is temporarily unavailable.');
    } catch (error) { onToast(error.message); }
  };
  const printTickets = () => {
    const printWindow = window.open('', '_blank', 'width=760,height=720');
    if (!printWindow || !booking?.tickets) return;
    const cards = booking.tickets.map((item) => `<article><h1>${event.title}</h1><p>${event.club_name || 'Independent event'}</p><p>${dateLabel(event.starts_at)} � ${timeLabel(event.starts_at)}</p><hr><strong>Ticket code</strong><code>${item.ticket_code}</code><p>Price paid: ${item.price_paid}</p></article>`).join('');
    printWindow.document.write(`<html><head><title>Tickets - ${event.title}</title><style>body{font-family:Arial;padding:24px}article{border:2px solid #102a43;padding:24px;margin:0 0 20px;max-width:600px}h1{color:#102a43}code{display:block;font-size:20px;margin-top:10px;word-break:break-all}</style></head><body>${cards}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  return <div className="ticket-booking"><div><strong>{ticket.name}</strong><small>{ticket.is_member ? 'Club member price' : 'Non-club member price'}: {unitPrice.toFixed(2)}</small><small>{ticket.remaining} spots remaining � Total: {(unitPrice * Number(quantity || 0)).toFixed(2)}</small></div><div className="ticket-booking-actions">{booking ? <button className="button button-small" onClick={printTickets}>Print ticket ?</button> : <><input type="number" min="1" max={Math.min(10, ticket.remaining)} value={quantity} onChange={(input) => setQuantity(input.target.value)} disabled={!ticket.remaining} /><button className="button button-small" onClick={book} disabled={!ticket.remaining}>Book ticket ?</button></>}</div></div>;
}

export function EventEditor({ event, clubs, allowIndependent, onChange, onClose, onSave }) {
  const update = (key, value) => onChange((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!event.id) return;
    request(`/events/${event.id}/ticket-types`).then((types) => {
      const ticket = Array.isArray(types) ? types[0] : types.data?.[0];
      if (ticket) onChange((current) => ({ ...current, ticket_type_id: ticket.id, ticket_name: ticket.name, member_price: ticket.member_price, non_member_price: ticket.non_member_price, quantity_available: ticket.quantity_available }));
    }).catch(() => {});
  }, [event.id]);
  return <div className="modal-backdrop"><section className="auth-modal editor-modal"><button className="modal-close" onClick={onClose}>�</button><span className="detail-eyebrow">{event.id ? 'EDIT EVENT' : 'NEW EVENT'}</span><h2>{event.id ? 'Shape the next gathering.' : 'Create a moment.'}</h2><form onSubmit={(submitEvent) => { submitEvent.preventDefault(); onSave(event); }}><label>Club<select value={event.club_id || ''} onChange={(input) => update('club_id', input.target.value ? Number(input.target.value) : null)} required={!event.id && !allowIndependent}><option value="">{allowIndependent ? 'Independent event' : 'Select an approved club'}</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label><label>Title<input value={event.title} onChange={(input) => update('title', input.target.value)} required /></label><label>Description<textarea value={event.description || ''} onChange={(input) => update('description', input.target.value)} rows="3" /></label><label>Location<input value={event.location || ''} onChange={(input) => update('location', input.target.value)} /></label><div className="form-two-col"><label>Starts<input type="datetime-local" value={event.starts_at?.slice(0, 16) || ''} onChange={(input) => update('starts_at', input.target.value)} required /></label><label>Ends<input type="datetime-local" value={event.ends_at?.slice(0, 16) || ''} onChange={(input) => update('ends_at', input.target.value)} required /></label></div><div className="form-two-col"><label>Ticket name<input value={event.ticket_name || ''} onChange={(input) => update('ticket_name', input.target.value)} required /></label><label>Tickets available<input type="number" min="0" value={event.quantity_available ?? 0} onChange={(input) => update('quantity_available', input.target.value)} required /></label></div><div className="form-two-col"><label>Member price<input type="number" min="0" step="0.01" value={event.member_price ?? 0} onChange={(input) => update('member_price', input.target.value)} required /></label><label>Non-member price<input type="number" min="0" step="0.01" value={event.non_member_price ?? 0} onChange={(input) => update('non_member_price', input.target.value)} required /></label></div>{event.id && <label>Status<select value={event.status || 'published'} onChange={(input) => update('status', input.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></label>}<button className="button button-full">Save event and tickets ?</button></form></section></div>;
}
