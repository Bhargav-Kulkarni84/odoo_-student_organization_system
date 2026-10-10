import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';

const API_BASE = '/api/v1';

async function request(path, options = {}) {
  const token = localStorage.getItem('gather_token');
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(payload.errors) ? payload.errors.map((item) => item.message).filter(Boolean).join(' ') : '';
    throw new Error([payload.message, detail].filter(Boolean).join(': ') || 'Something went wrong. Please try again.');
  }
  return payload;
}

const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const timeLabel = (value) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const emptyEvent = { title: '', description: '', location: '', starts_at: '', ends_at: '', capacity: 50, ticket_name: 'General Admission', member_price: 0, non_member_price: 0, quantity_available: 50 };

function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('gather_user') || 'null'));
  const [page, setPage] = useState(window.location.hash.replace('#', '') || 'dashboard');
  const [events, setEvents] = useState([]);
  const [managedEvents, setManagedEvents] = useState([]);
  const [users, setUsers] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [myClubs, setMyClubs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [authMode, setAuthMode] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventForm, setEventForm] = useState(null);

  const isManager = Boolean(user?.roles?.some((role) => ['ADMIN', 'TEAM_LEAD'].includes(role)));
  const isAdmin = Boolean(user?.roles?.includes('ADMIN'));
  const manageableClubs = isAdmin ? clubs : myClubs.filter((club) => club.status === 'approved' && ['lead', 'admin'].includes(club.member_role || club.role));
  const canManageEvents = isManager || manageableClubs.length > 0;
  const navigate = (nextPage) => {
    window.location.hash = nextPage;
    setPage(nextPage);
  };

  const loadEvents = async () => {
    setLoading(true);
    try {
      const response = await request('/events?upcoming=false');
      setEvents(response.data || []);
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadManagedEvents = async () => {
    if (!user) return;
    try {
      const response = await request('/events/managed');
      setManagedEvents(response.data || []);
    } catch (error) {
      setToast(error.message);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await request('/users');
      setUsers(response.data || []);
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadClubs = async () => {
    try {
      const approved = await request('/clubs?status=approved');
      const mine = user ? await request('/clubs/mine') : { data: [] };
      setClubs(approved.data || []);
      setMyClubs(mine.data || []);
    } catch (error) {
      setToast(error.message);
    }
  };

  useEffect(() => {
    const onHashChange = () => setPage(window.location.hash.replace('#', '') || 'dashboard');
    window.addEventListener('hashchange', onHashChange);
    loadEvents();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    loadClubs();
    if (user) loadManagedEvents();
  }, [user]);

  useEffect(() => {
    if (page === 'people') loadUsers();
  }, [page, user]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const logout = () => {
    localStorage.removeItem('gather_user');
    localStorage.removeItem('gather_token');
    setUser(null);
    navigate('dashboard');
    setToast('You have been logged out.');
  };

  const saveEvent = async (event) => {
    try {
      const path = event.id ? `/events/${event.id}` : '/events';
      const startsAt = new Date(event.starts_at);
      const endsAt = new Date(event.ends_at);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        throw new Error('Please provide valid start and end times.');
      }
      const payload = {
        title: event.title.trim(),
        description: event.description?.trim() || null,
        location: event.location?.trim() || null,
        capacity: Number(event.capacity),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        ...(event.club_id ? { club_id: Number(event.club_id) } : {}),
        ...(event.id && event.status ? { status: event.status } : {}),
      };

      const response = await request(path, { method: event.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      const ticketPayload = {
        name: event.ticket_name?.trim() || 'General Admission',
        member_price: Number(event.member_price || 0),
        non_member_price: Number(event.non_member_price || 0),
        quantity_available: Number(event.quantity_available || event.capacity),
      };
      if (event.ticket_type_id) {
        await request(`/events/${response.data.id}/ticket-types/${event.ticket_type_id}`, { method: 'PATCH', body: JSON.stringify(ticketPayload) });
      } else {
        await request(`/events/${response.data.id}/ticket-types`, { method: 'POST', body: JSON.stringify(ticketPayload) });
      }
      setEvents((current) => event.id ? current.map((item) => item.id === event.id ? response.data : item) : [response.data, ...current]);
      await loadManagedEvents();
      setEventForm(null);
      setToast(response.message || 'Event and ticket sales saved successfully.');
    } catch (error) {
      setToast(error.message);
    }
  };

  const deleteEvent = async (event) => {
    if (!window.confirm(`Delete "${event.title}" and its ticket types?`)) return;
    try {
      await request(`/events/${event.id}`, { method: 'DELETE' });
      setManagedEvents((current) => current.filter((item) => item.id !== event.id));
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setToast('Event deleted successfully.');
    } catch (error) {
      setToast(error.message);
    }
  };

  const pageTitle = { dashboard: 'Your campus, in one place', events: 'Explore campus events', clubs: 'Clubs and communities', people: 'The people behind campus life', profile: 'Your profile', manage: 'Manage events', approvals: 'Club approval requests' }[page] || 'Your campus, in one place';

  return (
    <div className="app-shell">
      {toast && <div className="toast-region"><div className="toast">{toast}</div></div>}
      <aside className="app-sidebar">
        <a className="brand" href="#dashboard"><span className="brand-mark">G</span><span>gather<span className="brand-dot">.</span></span></a>
        <div className="sidebar-label">Workspace</div>
        <nav className="app-nav">
          <NavItem active={page === 'dashboard'} icon="⌂" label="Overview" onClick={() => navigate('dashboard')} />
          <NavItem active={page === 'events'} icon="◷" label="Events" onClick={() => navigate('events')} />
          <NavItem active={page === 'clubs'} icon="♣" label="Clubs" onClick={() => navigate('clubs')} />
          <NavItem active={page === 'people'} icon="♧" label="People" onClick={() => navigate('people')} />
          {canManageEvents && <NavItem active={page === 'manage'} icon="✦" label="Manage events" onClick={() => navigate('manage')} />}
          {isAdmin && <NavItem active={page === 'approvals'} icon="✓" label="Club approvals" onClick={() => navigate('approvals')} />}
          <NavItem active={page === 'profile'} icon="◉" label="Profile" onClick={() => navigate('profile')} />
        </nav>
        <div className="sidebar-bottom">{user ? <><div className="sidebar-user"><span className="user-avatar">{user.name?.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.roles?.[0] || 'STUDENT'}</small></div></div><button className="sidebar-logout" onClick={logout}>Log out ↗</button></> : <button className="button button-small" onClick={() => setAuthMode('login')}>Log in to Gather</button>}</div>
      </aside>
      <main className="app-main">
        <header className="app-topbar"><div><span className="topbar-kicker">GATHER / {page.toUpperCase()}</span><h1>{pageTitle}</h1></div><div className="topbar-actions">{user ? <button className="button button-small" onClick={() => navigate('events')}>Find an event <span>↗</span></button> : <button className="button button-small" onClick={() => setAuthMode('register')}>Join Gather <span>↗</span></button>}</div></header>
        {!user && page !== 'dashboard' && <div className="auth-required state-message">Log in to access your community workspace. <button className="link-button" onClick={() => setAuthMode('login')}>Log in ↗</button></div>}
        {page === 'dashboard' && <Dashboard user={user} events={events} navigate={navigate} onAuth={() => setAuthMode('register')} />}
        {page === 'events' && <EventsPage events={events} loading={loading} user={user} onSelect={setSelectedEvent} />}
        {page === 'clubs' && <ClubsPage clubs={clubs} myClubs={myClubs} user={user} onCreated={loadClubs} onToast={setToast} onLogin={() => setAuthMode('login')} onManage={() => navigate('manage')} />}
        {page === 'people' && <PeoplePage users={users} loading={loading} />}
        {page === 'profile' && user && <ProfilePage user={user} />}
        {page === 'manage' && user && canManageEvents && <ManagePage events={managedEvents} clubs={manageableClubs} allowIndependent={isManager && !isAdmin} onNew={() => setEventForm({ ...emptyEvent, club_id: '' })} onEdit={setEventForm} onDelete={deleteEvent} />}
        {page === 'approvals' && user && isAdmin && <ClubApprovals onChanged={loadClubs} onToast={setToast} />}
      </main>
      {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSuccess={(nextUser, token, registered) => { if (registered && !token) { setAuthMode('login'); setToast('Registration successful. Log in to continue.'); return; } localStorage.setItem('gather_user', JSON.stringify(nextUser)); localStorage.setItem('gather_token', token); setUser(nextUser); setAuthMode(null); setToast(`Welcome, ${nextUser.name}.`); }} setMode={setAuthMode} />}
      {selectedEvent && <EventModal event={selectedEvent} user={user} onClose={() => setSelectedEvent(null)} onLogin={() => { setSelectedEvent(null); setAuthMode('login'); }} onToast={setToast} />}
      {eventForm && <EventEditor event={eventForm} clubs={manageableClubs} allowIndependent={isManager && !isAdmin} onChange={setEventForm} onClose={() => setEventForm(null)} onSave={saveEvent} />}
    </div>
  );
}

function NavItem({ active, icon, label, onClick }) {
  return <button className={`app-nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span>{label}</button>;
}

function ClubsPage({ clubs, myClubs, user, onCreated, onToast, onLogin, onManage }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', category: '', description: '' });

  const submit = async (event) => {
    event.preventDefault();
    try {
      await request('/clubs', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', category: '', description: '' });
      setFormOpen(false);
      onCreated();
      onToast('Club request submitted for admin approval.');
    } catch (error) {
      onToast(error.message);
    }
  };

  return <section className="workspace-section">
    <div className="manage-heading"><div><p>Discover approved clubs and submit your own club for approval.</p></div>{user ? <button className="button" onClick={() => setFormOpen((open) => !open)}>Create a club ↗</button> : <button className="button" onClick={onLogin}>Log in to create a club ↗</button>}</div>
    {formOpen && <form className="club-form" onSubmit={submit}><h2>Submit a club request</h2><p>The main admin must approve the club before its lead can create events.</p><label>Club name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Technology, culture, service..." required /></label><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} minLength="10" rows="4" required /></label><button className="button">Submit for approval ↗</button></form>}
    <div className="club-section-heading"><span className="topbar-kicker">APPROVED CLUBS</span><h2>Find your circle.</h2></div>
    {clubs.length ? <div className="club-grid">{clubs.map((club) => <article className="club-card" key={club.id}><span className="community-badge mint">{club.category}</span><h3>{club.name}</h3><p>{club.description}</p><footer><span>{club.member_count} members</span><span>Approved</span></footer></article>)}</div> : <div className="state-message">No approved clubs have been published yet.</div>}
    {user && <><div className="club-section-heading"><span className="topbar-kicker">YOUR CLUB REQUESTS</span><h2>Application status.</h2></div>{myClubs.length ? <div className="club-request-list">{myClubs.map((club) => <div className="club-request" key={club.id}><div><strong>{club.name}</strong><span>{club.category}</span></div><b className={`request-status ${club.status}`}>{club.status}</b>{club.status === 'approved' && ['lead', 'admin'].includes(club.role) && <button className="link-button" onClick={onManage}>Manage club ↗</button>}</div>)}</div> : <div className="state-message">You have not submitted a club request.</div>}</>}
  </section>;
}

function ClubApprovals({ onChanged, onToast }) {
  const [pending, setPending] = useState([]);
  const load = async () => {
    try {
      const response = await request('/clubs?status=pending');
      setPending(response.data || []);
    } catch (error) {
      onToast(error.message);
    }
  };
  useEffect(() => { load(); }, []);
  const decide = async (id, status) => {
    try {
      await request(`/clubs/${id}/approval`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
      onChanged();
      onToast(`Club ${status}.`);
    } catch (error) {
      onToast(error.message);
    }
  };
  return <section className="workspace-section"><p className="admin-note">Only users with the ADMIN role can approve or reject student club requests.</p>{pending.length ? <div className="approval-list">{pending.map((club) => <article className="approval-card" key={club.id}><div><span className="community-badge orange">{club.category}</span><h3>{club.name}</h3><p>{club.description}</p><small>Submitted by {club.creator_name}</small></div><div className="approval-actions"><button className="button button-small" onClick={() => decide(club.id, 'approved')}>Approve</button><button className="link-button danger-link" onClick={() => decide(club.id, 'rejected')}>Reject</button></div></article>)}</div> : <div className="state-message">There are no pending club requests.</div>}</section>;
}

function Dashboard({ user, events, navigate, onAuth }) {
  const upcoming = events.filter((event) => new Date(event.starts_at) >= new Date()).slice(0, 3);
  if (!user) return <section className="welcome-panel"><div><span className="topbar-kicker">A BETTER CAMPUS STARTS HERE</span><h2>Find your people.<br /><em>Make it matter.</em></h2><p>Discover events, meet collaborators, and make campus life feel like it belongs to you.</p><button className="button" onClick={onAuth}>Create your account ↗</button></div><div className="welcome-art"><strong>Good things happen</strong><span>when you show up.</span></div></section>;
  return <><section className="dashboard-welcome"><div><span className="topbar-kicker">YOUR COMMUNITY</span><h2>Welcome back,<br /><em>{user.name}.</em></h2><p>Here&apos;s what&apos;s happening across your campus today.</p></div><button className="button button-light" onClick={() => navigate('events')}>Explore events ↗</button></section><div className="stat-grid"><Stat label="Upcoming events" value={events.filter((event) => new Date(event.starts_at) >= new Date()).length} note="published on campus" /><Stat label="Your role" value={user.roles?.length ? user.roles.join(' · ') : 'Not returned by API'} note="from your auth token" /><Stat label="Published events" value={events.length} note="returned by the API" /></div><section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">NEXT UP</span><h2>Don&apos;t miss these.</h2></div><button className="link-button" onClick={() => navigate('events')}>View all events ↗</button></div>{upcoming.length ? <div className="compact-event-grid">{upcoming.map((event) => <EventRow key={event.id} event={event} />)}</div> : <div className="state-message">No upcoming published events were returned by the API.</div>}</section></>;
}

function Stat({ label, value, note }) { return <article className="stat-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

function EventsPage({ events, loading, onSelect }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => events.filter((event) => `${event.title} ${event.description} ${event.location} ${event.club_name}`.toLowerCase().includes(query.toLowerCase())).filter((event) => filter === 'all' || (filter === 'upcoming' && new Date(event.starts_at) >= new Date())), [events, query, filter]);
  return <section className="workspace-section"><div className="toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events, clubs, or locations..." /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All published events</option><option value="upcoming">Upcoming published events</option></select></div>{loading ? <div className="state-message">Loading events...</div> : <div className="event-list-grid">{filtered.map((event) => <article className="workspace-event-card" key={event.id} onClick={() => onSelect(event)}><div className="event-card-top"><span className="date-chip">{dateLabel(event.starts_at)}</span><span className="status-pill">{event.status}</span></div><h3>{event.title}</h3><p>{event.description || 'No description was provided for this event.'}</p><div className="event-card-footer"><span>♣ {event.club_name || 'Independent event'}</span><span>⌖ {event.location || 'Location not provided'}</span></div></article>)}</div>}</section>;
}

function EventRow({ event }) { return <article className="event-row"><span className="date-block"><strong>{new Date(event.starts_at).getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(event.starts_at))}</small></span><div><h3>{event.title}</h3><p>{event.club_name || 'Independent event'} · {timeLabel(event.starts_at)} · {event.location || 'Campus'}</p></div><span className="row-arrow">↗</span></article>; }

function PeoplePage({ users, loading }) { return <section className="workspace-section"><div className="people-intro"><p>People returned by the users API.</p><span>{users.length} users returned</span></div>{loading ? <div className="state-message">Loading people...</div> : <div className="people-grid">{users.map((person) => <article className="person-card" key={person.id}><span className="person-avatar">{person.name?.slice(0, 1).toUpperCase()}</span><h3>{person.name}</h3><p>{person.email}</p><span className="role-tag">{person.role || 'Role not returned'}</span><small className={person.is_active ? 'active-text' : 'inactive-text'}>{person.is_active ? 'Active' : 'Inactive'}</small></article>)}</div>}</section>; }

function ProfilePage({ user }) { return <section className="profile-card"><div className="profile-hero"><span className="profile-avatar">{user.name?.slice(0, 1).toUpperCase()}</span><div><span className="topbar-kicker">MEMBER PROFILE</span><h2>{user.name}</h2><p>{user.email}</p></div></div><div className="profile-details"><div><span>Account ID</span><strong>#{user.id}</strong></div><div><span>Roles</span><strong>{user.roles?.join(' · ') || 'STUDENT'}</strong></div><div><span>Status</span><strong className="active-text">Active member</strong></div></div></section>; }

function ManagePage({ events, clubs, allowIndependent, onNew, onEdit, onDelete }) { return <section className="workspace-section"><div className="manage-heading"><div><p>Create and maintain events and ticket sales for approved clubs.</p></div><button className="button" onClick={onNew} disabled={!clubs.length && !allowIndependent}>Create event ↗</button></div><div className="manage-table"><div className="table-head"><span>Event</span><span>Club / schedule</span><span>Status</span><span>Action</span></div>{events.map((event) => <div className="table-row" key={event.id}><strong>{event.title}</strong><span>{event.club_name || 'Independent event'}<small>{dateLabel(event.starts_at)} · {timeLabel(event.starts_at)}</small></span><span className="status-pill">{event.status}</span><span><button className="link-button" onClick={() => onEdit(event)}>Edit ↗</button><button className="link-button danger-link" onClick={() => onDelete(event)}>Delete</button></span></div>)}</div>{!clubs.length && !allowIndependent && <div className="state-message">No approved club is available for event creation.</div>}</section>; }

function EventModal({ event, user, onClose, onLogin, onToast }) { return <div className="modal-backdrop" onClick={(click) => click.target === click.currentTarget && onClose()}><section className="event-detail-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}>×</button><span className="detail-eyebrow">EVENT DETAILS</span><h2>{event.title}</h2><div className="detail-meta"><span>{event.club_name || 'Independent event'}</span><span>{dateLabel(event.starts_at)}</span><span>{timeLabel(event.starts_at)}</span><span>{event.location || 'Location not provided'}</span><span>{event.capacity} spots</span></div><p id="event-detail-description">{event.description || 'No description was provided for this event.'}</p><TicketBooking event={event} user={user} onLogin={onLogin} onToast={onToast} /><div className="detail-actions"><button className="link-button" onClick={onClose}>Close</button></div></section></div>; }

function TicketBooking({ event, user, onLogin, onToast }) {
  const [ticket, setTicket] = useState(null);
  const [quantity, setQuantity] = useState(1);
  useEffect(() => { request(`/events/${event.id}/ticket-types`).then((types) => setTicket(Array.isArray(types) ? types[0] : types.data?.[0] || null)).catch(() => setTicket(null)); }, [event.id]);
  if (!ticket) return null;
  const book = async () => {
    if (!user) return onLogin();
    try {
      await request('/ticket-orders', { method: 'POST', body: JSON.stringify({ ticket_type_id: Number(ticket.id), quantity: Number(quantity) }) });
      onToast('Tickets reserved successfully.');
    } catch (error) { onToast(error.message); }
  };
  return <div className="ticket-booking"><div><strong>{ticket.name}</strong><small>Member: {ticket.member_price} · Non-member: {ticket.non_member_price}</small></div><div className="ticket-booking-actions"><input type="number" min="1" max="10" value={quantity} onChange={(input) => setQuantity(input.target.value)} /><button className="button button-small" onClick={book}>Book ticket ↗</button></div></div>;
}

function EventEditor({ event, clubs, allowIndependent, onChange, onClose, onSave }) {
  const update = (key, value) => onChange((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!event.id) return;
    request(`/events/${event.id}/ticket-types`).then((types) => {
      const ticket = Array.isArray(types) ? types[0] : types.data?.[0];
      if (ticket) onChange((current) => ({ ...current, ticket_type_id: ticket.id, ticket_name: ticket.name, member_price: ticket.member_price, non_member_price: ticket.non_member_price, quantity_available: ticket.quantity_available }));
    }).catch(() => {});
  }, [event.id]);
  return <div className="modal-backdrop"><section className="auth-modal editor-modal"><button className="modal-close" onClick={onClose}>×</button><span className="detail-eyebrow">{event.id ? 'EDIT EVENT' : 'NEW EVENT'}</span><h2>{event.id ? 'Shape the next gathering.' : 'Create a moment.'}</h2><form onSubmit={(submitEvent) => { submitEvent.preventDefault(); onSave(event); }}><label>Club<select value={event.club_id || ''} onChange={(input) => update('club_id', input.target.value ? Number(input.target.value) : null)} required={!event.id && !allowIndependent}><option value="">{allowIndependent ? 'Independent event' : 'Select an approved club'}</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label><label>Title<input value={event.title} onChange={(input) => update('title', input.target.value)} required /></label><label>Description<textarea value={event.description || ''} onChange={(input) => update('description', input.target.value)} rows="3" /></label><label>Location<input value={event.location || ''} onChange={(input) => update('location', input.target.value)} /></label><div className="form-two-col"><label>Starts<input type="datetime-local" value={event.starts_at?.slice(0, 16) || ''} onChange={(input) => update('starts_at', input.target.value)} required /></label><label>Ends<input type="datetime-local" value={event.ends_at?.slice(0, 16) || ''} onChange={(input) => update('ends_at', input.target.value)} required /></label></div><label>Capacity<input type="number" min="1" value={event.capacity} onChange={(input) => update('capacity', input.target.value)} required /></label><div className="form-two-col"><label>Ticket name<input value={event.ticket_name || ''} onChange={(input) => update('ticket_name', input.target.value)} required /></label><label>Tickets available<input type="number" min="0" value={event.quantity_available ?? event.capacity} onChange={(input) => update('quantity_available', input.target.value)} required /></label></div><div className="form-two-col"><label>Member price<input type="number" min="0" step="0.01" value={event.member_price ?? 0} onChange={(input) => update('member_price', input.target.value)} required /></label><label>Non-member price<input type="number" min="0" step="0.01" value={event.non_member_price ?? 0} onChange={(input) => update('non_member_price', input.target.value)} required /></label></div>{event.id && <label>Status<select value={event.status || 'published'} onChange={(input) => update('status', input.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></label>}<button className="button button-full">Save event and tickets ↗</button></form></section></div>;
}

function AuthModal({ mode, onClose, onSuccess, setMode }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const register = mode === 'register';
  const submit = async (event) => {
    event.preventDefault(); setSubmitting(true); setMessage('');
    try {
      const payload = await request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(register ? form : { email: form.email, password: form.password }) });
      onSuccess(payload.data, payload.token, register);
    } catch (error) { setMessage(error.message); } finally { setSubmitting(false); }
  };
  return <div className="modal-backdrop"><section className="auth-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}>×</button><span className="auth-kicker">WELCOME TO GATHER</span><h2>{register ? <>Make room<br /><em>for more.</em></> : <>Good to<br /><em>see you.</em></>}</h2><p>{register ? 'Create an account to find events and meet your people.' : 'Log in to your campus workspace.'}</p><div className="auth-tabs"><button className={`auth-tab ${register ? 'active' : ''}`} onClick={() => setMode('register')}>Create account</button><button className={`auth-tab ${!register ? 'active' : ''}`} onClick={() => setMode('login')}>Log in</button></div><form onSubmit={submit}>{register && <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>}<label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>Password<input type="password" minLength="6" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label><button className="button button-full" disabled={submitting}>{submitting ? 'Working...' : register ? 'Create my account ↗' : 'Log in ↗'}</button><div className="form-message">{message}</div></form></section></div>;
}

createRoot(document.getElementById('root')).render(<App />);
