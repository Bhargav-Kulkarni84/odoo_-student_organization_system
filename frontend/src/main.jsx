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
  if (response.status === 401) {
    localStorage.removeItem('gather_user');
    localStorage.removeItem('gather_token');
    window.dispatchEvent(new Event('gather:unauthorized'));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(payload.errors) ? payload.errors.map((item) => item.message).filter(Boolean).join(' ') : '';
    throw new Error([payload.message, detail].filter(Boolean).join(': ') || 'Something went wrong. Please try again.');
  }
  return payload;
}

const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const timeLabel = (value) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const emptyEvent = { title: '', description: '', location: '', starts_at: '', ends_at: '', ticket_name: 'General Admission', member_price: 0, non_member_price: 0, quantity_available: 50 };

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
    const handleUnauthorized = () => {
      setUser(null);
      setToast('Your session expired. Please log in again.');
    };
    window.addEventListener('gather:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('gather:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    if (page !== 'events') return undefined;
    loadEvents();
    const refreshOnFocus = () => loadEvents();
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [page]);

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
        quantity_available: Number(event.quantity_available),
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
    if (!window.confirm(`Delete "${event.title}" and its ticket types?\n\nEvents with issued tickets cannot be deleted; cancel those events instead.`)) return;
    try {
      await request(`/events/${event.id}`, { method: 'DELETE' });
      setManagedEvents((current) => current.filter((item) => item.id !== event.id));
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setToast('Event deleted successfully.');
    } catch (error) {
      setToast(error.message);
    }
  };

  const pageTitle = { dashboard: 'Overview', events: 'Events', clubs: 'Clubs', people: 'People', profile: 'Profile', manage: 'Manage events', approvals: 'Club approvals', membership: 'Membership', announcements: 'Announcements', merchandise: 'Merchandise', fundraisers: 'Fundraisers', expenses: 'Expenses', finances: 'Finances', tickets: 'My tickets', checkin: 'Ticket check-in' }[page] || 'Overview';

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
          <NavItem active={page === 'membership'} icon="◎" label="Membership" onClick={() => navigate('membership')} />
          {user && <NavItem active={page === 'tickets'} icon="▤" label="My tickets" onClick={() => navigate('tickets')} />}
          <NavItem active={page === 'announcements'} icon="✉" label="Announcements" onClick={() => navigate('announcements')} />
          <NavItem active={page === 'merchandise'} icon="▣" label="Merchandise" onClick={() => navigate('merchandise')} />
          <NavItem active={page === 'fundraisers'} icon="↗" label="Fundraisers" onClick={() => navigate('fundraisers')} />
          {user && <NavItem active={page === 'expenses'} icon="⌁" label="Expenses" onClick={() => navigate('expenses')} />}
          {user && <NavItem active={page === 'finances'} icon="$" label="Finances" onClick={() => navigate('finances')} />}
          {canManageEvents && <NavItem active={page === 'manage'} icon="✦" label="Manage events" onClick={() => navigate('manage')} />}
          {canManageEvents && <NavItem active={page === 'checkin'} icon="✓" label="Check-in" onClick={() => navigate('checkin')} />}
          {isAdmin && <NavItem active={page === 'approvals'} icon="✓" label="Club approvals" onClick={() => navigate('approvals')} />}
          <NavItem active={page === 'profile'} icon="◉" label="Profile" onClick={() => navigate('profile')} />
        </nav>
        <div className="sidebar-bottom">{!user && <button className="button button-small" onClick={() => setAuthMode('login')}>Log in to Gather</button>}</div>
      </aside>
      <main className="app-main">
        <header className="app-topbar"><div><span className="topbar-kicker">GATHER / {page.toUpperCase()}</span><h1>{pageTitle}</h1></div><div className="topbar-actions">{user ? <><div className="topbar-user"><span className="user-avatar">{user.name?.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.roles?.[0] || 'STUDENT'}</small></div></div><button className="topbar-profile" onClick={() => navigate('profile')}>Profile</button><button className="topbar-logout" onClick={logout}>Log out</button></> : <button className="button button-small" onClick={() => setAuthMode('register')}>Join Gather <span>↗</span></button>}</div></header>
        {!user && page !== 'dashboard' && <div className="auth-required state-message">Log in to access your community workspace. <button className="link-button" onClick={() => setAuthMode('login')}>Log in ↗</button></div>}
        {page === 'dashboard' && <Dashboard user={user} events={events} navigate={navigate} onAuth={() => setAuthMode('register')} />}
        {page === 'events' && <EventsPage events={events} loading={loading} onRefresh={loadEvents} onSelect={setSelectedEvent} />}
        {page === 'clubs' && <ClubsPage clubs={clubs} myClubs={myClubs} user={user} onCreated={loadClubs} onToast={setToast} onLogin={() => setAuthMode('login')} onManage={() => navigate('manage')} />}
        {page === 'people' && <PeoplePage users={users} loading={loading} />}
        {page === 'membership' && <MembershipPage user={user} myClubs={myClubs} onLogin={() => setAuthMode('login')} onToast={setToast} />}
        {page === 'tickets' && user && <MyTicketsPage onToast={setToast} />}
        {page === 'checkin' && user && canManageEvents && <CheckInPage onToast={setToast} />}
        {page === 'announcements' && <AnnouncementsPage user={user} onToast={setToast} />}
        {page === 'merchandise' && <MerchandisePage user={user} onToast={setToast} />}
        {page === 'fundraisers' && <FundraisersPage user={user} onToast={setToast} />}
        {page === 'expenses' && user && <ExpensesPage onToast={setToast} />}
        {page === 'finances' && user && <FinancesPage onToast={setToast} />}
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

const money = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'INR' });
const apiList = (payload, key) => payload?.[key] || payload?.data || [];
const benefitsLabel = (benefits) => typeof benefits === 'string' ? benefits : benefits ? Object.entries(benefits).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`).join(' · ') : 'Member discounts and access to club activities.';
const announcementBody = (body) => {
  const value = String(body || '');
  return /(?:error:|severity:\s*['"]fatal|code:\s*['"]53300|at process\.)/i.test(value)
    ? 'This announcement is temporarily unavailable. Please contact the campus team.'
    : value;
};

function MembershipPage({ user, myClubs, onLogin, onToast }) {
  const [plans, setPlans] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [selectedClub, setSelectedClub] = useState(null);
  const [joinMessage, setJoinMessage] = useState('');
  const [requests, setRequests] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const planPayload = await request('/memberships/plans');
      setPlans(planPayload.data || []);
      if (user) setMemberships((await request('/memberships/me')).data || []);
      setClubs((await request('/clubs?status=approved')).data || []);
      if (user) setJoinRequests((await request('/clubs/join-requests/mine')).data || []);
    } catch (error) { onToast(error.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [user]);
  const join = async (planId) => {
    if (!user) return onLogin();
    try { await request('/memberships', { method: 'POST', body: JSON.stringify({ plan_id: Number(planId) }) }); onToast('Membership request submitted.'); load(); } catch (error) { onToast(error.message); }
  };
  const loadRequests = async (clubId) => { try { setRequests((await request(`/clubs/${clubId}/join-requests`)).data || []); } catch (error) { onToast(error.message); } };
  const applyToClub = async (event) => { event.preventDefault(); if (!user) return onLogin(); try { await request(`/clubs/${selectedClub.id}/join-requests`, { method: 'POST', body: JSON.stringify({ message: joinMessage }) }); setSelectedClub(null); setJoinMessage(''); onToast(`Request sent to ${selectedClub.name}.`); load(); } catch (error) { onToast(error.message); } };
  const decideRequest = async (requestId, status) => { try { await request(`/clubs/${selectedClub.id}/join-requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); onToast(`Join request ${status}.`); loadRequests(selectedClub.id); } catch (error) { onToast(error.message); } };
  const leadClubs = (myClubs || []).filter((club) => club.status === 'approved' && ['lead', 'admin'].includes(club.role));
  const clubMembership = (clubId) => (myClubs || []).find((item) => item.id === clubId) || joinRequests.find((item) => item.club_id === clubId);
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">BELONG</span><h2>Membership that travels with you.</h2><p>Apply for benefits, discounts, and a clear renewal history.</p></div></div>{loading ? <div className="state-message">Loading membership plans...</div> : <><div className="club-section-heading"><span className="topbar-kicker">CLUB MEMBERSHIPS</span><h2>Find your people.</h2><p>Send a request to join an approved club. Its lead will review your application.</p></div><div className="club-grid">{clubs.map((club) => { const mine = clubMembership(club.id); return <article className="club-card" key={club.id}><span className="community-badge mint">{club.category}</span><h3>{club.name}</h3><p>{club.description}</p><footer><span>{club.member_count} members</span>{mine ? <b className={`request-status ${mine.join_request_status || mine.status || 'approved'}`}>{mine.join_request_status || mine.status || 'member'}</b> : <button className="button button-small" onClick={() => setSelectedClub(club)}>Request to join ↗</button>}</footer></article>; })}</div><div className="club-section-heading"><span className="topbar-kicker">PAID MEMBERSHIP PLANS</span><h2>More ways to participate.</h2></div><div className="club-grid">{plans.map((plan) => <article className="club-card" key={plan.id}><span className="community-badge mint">{plan.duration_days} days</span><h3>{plan.name}</h3><p>{benefitsLabel(plan.benefits)}</p><footer><strong>{money(plan.price)}</strong><button className="button button-small" onClick={() => join(plan.id)}>Apply ↗</button></footer></article>)}</div>{user && <div className="workspace-section"><div className="club-section-heading"><span className="topbar-kicker">YOUR MEMBERSHIP</span><h2>History and status</h2></div>{memberships.length ? <div className="club-request-list">{memberships.map((item) => <div className="club-request" key={item.id}><div><strong>{item.plan_name}</strong><span>{item.start_date} — {item.end_date}</span></div><b className={`request-status ${item.status}`}>{item.status}</b></div>)}</div> : <div className="state-message">You do not have a paid membership yet.</div>}</div>}{leadClubs.length > 0 && <div className="workspace-section"><div className="club-section-heading"><span className="topbar-kicker">CLUB LEAD REVIEW</span><h2>Approve new members.</h2></div><div className="club-request-list">{leadClubs.map((club) => <div className="club-request" key={club.id}><div><strong>{club.name}</strong><span>Review requests from students</span></div><button className="link-button" onClick={() => { setSelectedClub(club); loadRequests(club.id); }}>View requests ↗</button></div>)}</div></div>}</>}{selectedClub && <div className="modal-backdrop"><section className="auth-modal editor-modal"><button className="modal-close" onClick={() => setSelectedClub(null)}>×</button><span className="detail-eyebrow">{leadClubs.some((club) => club.id === selectedClub.id) ? 'MEMBERSHIP REVIEW' : 'JOIN CLUB'}</span><h2>{leadClubs.some((club) => club.id === selectedClub.id) ? `Requests for ${selectedClub.name}` : `Join ${selectedClub.name}`}</h2>{leadClubs.some((club) => club.id === selectedClub.id) ? <div className="club-request-list">{requests.length ? requests.map((item) => <div className="club-request" key={item.id}><div><strong>{item.user_name}</strong><span>{item.email}{item.message ? ` · ${item.message}` : ''}</span></div><div className="approval-actions"><button className="button button-small" onClick={() => decideRequest(item.id, 'approved')}>Approve</button><button className="link-button danger-link" onClick={() => decideRequest(item.id, 'rejected')}>Reject</button></div></div>) : <div className="state-message">No pending join requests.</div>}</div> : <form onSubmit={applyToClub}><p>Tell the club lead why you would like to join. Your student profile and this message will be shared with the club team.</p><label>Message<textarea value={joinMessage} onChange={(event) => setJoinMessage(event.target.value)} rows="4" placeholder="What would you like to contribute?" /></label><button className="button button-full">Send join request ↗</button></form>}</section></div>}</section>;
}

function MyTicketsPage({ onToast }) {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => { request('/ticket-orders/me').then(setOrders).catch((error) => onToast(error.message)); }, []);
  const openOrder = async (id) => { try { setSelected(await request(`/ticket-orders/${id}`)); } catch (error) { onToast(error.message); } };
  const openReceipt = async (id) => { try { const response = await request(`/ticket-orders/${id}/receipt`); window.open(response.url, '_blank', 'noopener,noreferrer'); } catch (error) { onToast(error.message); } };
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">YOUR PASSES</span><h2>Everything you booked.</h2><p>Open an order to see ticket codes and access its secure receipt.</p></div></div>{orders.length ? <div className="club-request-list">{orders.map((order) => <div className="club-request" key={order.id}><div><strong>Order #{order.id}</strong><span>{order.created_at ? dateLabel(order.created_at) : ''} · {order.ticket_count} ticket(s) · {money(order.total_amount)}</span></div><div className="ticket-order-actions"><b className={`request-status ${order.status}`}>{order.status}</b><button className="link-button" onClick={() => openOrder(order.id)}>View tickets ↗</button>{order.receipt_available && <button className="link-button" onClick={() => openReceipt(order.id)}>Open receipt ↗</button>}</div></div>)}</div> : <div className="state-message">You have not booked any tickets yet.</div>}{selected && <div className="club-form"><div className="workspace-heading"><h3>Order #{selected.order.id}</h3><div><button className="link-button" onClick={() => openReceipt(selected.order.id)}>Open receipt ↗</button><button className="link-button" onClick={() => setSelected(null)}>Close</button></div></div>{selected.tickets.map((ticket) => <div className="club-request" key={ticket.id}><div><strong>{ticket.ticket_code}</strong><span>{ticket.attendee_name || 'Attendee'} · {money(ticket.price_paid)}</span></div><span>{ticket.checked_in_at ? 'Checked in' : 'Valid ticket'}</span></div>)}</div>}</section>;
}

function CheckInPage({ onToast }) {
  const [ticketId, setTicketId] = useState('');
  const [result, setResult] = useState(null);
  const submit = async (event) => { event.preventDefault(); try { const response = await request(`/tickets/${Number(ticketId)}/check-in`, { method: 'POST' }); setResult(response.ticket); setTicketId(''); onToast(response.message); } catch (error) { setResult(null); onToast(error.message); } };
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">DOOR DESK</span><h2>Check in a ticket in seconds.</h2><p>Enter the ticket ID from the attendee’s pass and record attendance without a printed list.</p></div></div><form className="club-form" onSubmit={submit}><label>Ticket ID<input type="number" min="1" value={ticketId} onChange={(event) => setTicketId(event.target.value)} placeholder="e.g. 1042" required /></label><button className="button">Check in ticket ↗</button></form>{result && <div className="club-card"><span className="community-badge mint">Checked in</span><h3>{result.ticket_code}</h3><p>{result.attendee_name || 'Attendee'} · {result.checked_in_at ? dateLabel(result.checked_in_at) : 'Just now'}</p></div>}</section>;
}

function AnnouncementsPage({ user, onToast }) {
  const [items, setItems] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [events, setEvents] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ title: '', body: '', audience: 'all_users', event_id: '', club_id: '', user_ids: [] });
  const load = async () => { try { setItems((await request('/announcements')).announcements || []); } catch (error) { onToast(error.message); } };
  useEffect(() => { load(); if (user) { Promise.all([request('/clubs?status=approved'), request('/events?upcoming=false'), request('/users')]).then(([clubResult, eventResult, userResult]) => { setClubs(clubResult.data || []); setEvents(eventResult.data || []); setUsers(userResult.data || []); }).catch((error) => onToast(error.message)); } }, [user]);
  const create = async (event) => { event.preventDefault(); try { const audience = { audience: form.audience, ...(form.event_id ? { event_id: Number(form.event_id) } : {}), ...(form.club_id ? { club_id: Number(form.club_id) } : {}), ...(form.user_ids.length ? { user_ids: form.user_ids.map(Number) } : {}) }; const result = await request('/announcements', { method: 'POST', body: JSON.stringify({ title: form.title, body: form.body }) }); await request(`/announcements/${result.announcement.id}/publish`, { method: 'POST', body: JSON.stringify(audience) }); setForm({ title: '', body: '', audience: 'all_users', event_id: '', club_id: '', user_ids: [] }); onToast('Announcement published and sent through Brevo.'); load(); } catch (error) { onToast(error.message); } };
  const updateAudience = (value) => setForm({ ...form, audience: value, event_id: '', club_id: '', user_ids: [] });
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">ONE MESSAGE, EVERYONE</span><h2>Keep the club in sync.</h2><p>Target event participants, club members, a specific club student, or the whole campus through Brevo.</p></div></div>{user && <form className="club-form" onSubmit={create}><h3>Send an announcement</h3><label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label><label>Message<textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} rows="3" required /></label><label>Audience<select value={form.audience} onChange={(event) => updateAudience(event.target.value)}><option value="all_users">All active students</option><option value="event_participants">Participants of an event</option><option value="club_members">All members of a club</option><option value="individual_users">Specific individual(s)</option></select></label>{form.audience === 'event_participants' && <label>Event<select value={form.event_id} onChange={(event) => setForm({ ...form, event_id: event.target.value })} required><option value="">Select event</option>{events.map((item) => <option key={item.id} value={item.id}>{item.title} {item.club_name ? `· ${item.club_name}` : ''}</option>)}</select></label>}{['club_members', 'individual_users'].includes(form.audience) && <label>Club<select value={form.club_id} onChange={(event) => setForm({ ...form, club_id: event.target.value, user_ids: [] })} required><option value="">Select club</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>}{form.audience === 'individual_users' && <label>Individual students<select multiple value={form.user_ids.map(String)} onChange={(event) => setForm({ ...form, user_ids: [...event.target.selectedOptions].map((option) => option.value) })} required>{users.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.email}</option>)}</select><small>Hold Ctrl/Cmd to select more than one.</small></label>}<button className="button">Send with Brevo ↗</button></form>}<div className="club-grid">{items.length ? items.map((item) => <article className="club-card" key={item.id}><span className="community-badge orange">{item.published_at ? dateLabel(item.published_at) : 'Published'}</span><h3>{item.title}</h3><p>{announcementBody(item.body)}</p><footer><span>{item.published_by_name || 'Club team'}</span></footer></article>) : <div className="state-message">No announcements have been published yet.</div>}</div></section>;
}

function MerchandisePage({ user, onToast }) {
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState({});
  const load = async () => { try { setProducts((await request('/merchandise/products')).products || []); } catch (error) { onToast(error.message); } };
  useEffect(() => { load(); }, []);
  const order = async () => {
    if (!user) return onToast('Log in to order merchandise.');
    const items = Object.entries(quantities).filter(([, quantity]) => Number(quantity) > 0).map(([product_variant_id, quantity]) => ({ product_variant_id: Number(product_variant_id), quantity: Number(quantity) }));
    if (!items.length) return onToast('Choose at least one item.');
    try { await request('/merchandise/orders', { method: 'POST', body: JSON.stringify({ items }) }); setQuantities({}); onToast('Merchandise order placed.'); load(); } catch (error) { onToast(error.message); }
  };
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">CAMPUS STORE</span><h2>Wear what you build.</h2><p>Choose a size, see live stock, and place an order from your phone.</p></div><button className="button" onClick={order}>Place order ↗</button></div><div className="club-grid">{products.length ? products.map((product) => <article className="club-card" key={product.id}><span className="community-badge mint">Merchandise</span><h3>{product.name}</h3><p>{product.description || 'Club merchandise.'}</p><div className="merch-variants">{(product.variants || []).map((variant) => <label key={variant.id}><span>{variant.size} · {money(variant.price)} · {variant.stock_quantity} left</span><input type="number" min="0" max={variant.stock_quantity} value={quantities[variant.id] || ''} onChange={(event) => setQuantities({ ...quantities, [variant.id]: event.target.value })} disabled={!variant.stock_quantity} /></label>)}</div></article>) : <div className="state-message">No merchandise is available right now.</div>}</div></section>;
}

function FundraisersPage({ user, onToast }) {
  const [fundraisers, setFundraisers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({ name: '', description: '', target_amount: '' });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', fundraiser_id: '', due_at: '' });
  const load = async () => { try { setFundraisers((await request('/fundraisers')).fundraisers || []); if (user) setTasks((await request('/tasks/me')).tasks || []); } catch (error) { onToast(error.message); } };
  useEffect(() => { load(); }, [user]);
  const create = async (event) => { event.preventDefault(); try { await request('/fundraisers', { method: 'POST', body: JSON.stringify({ ...form, target_amount: form.target_amount ? Number(form.target_amount) : null }) }); setForm({ name: '', description: '', target_amount: '' }); onToast('Fundraiser created.'); load(); } catch (error) { onToast(error.message); } };
  const createTask = async (event) => { event.preventDefault(); try { await request('/tasks', { method: 'POST', body: JSON.stringify({ ...taskForm, fundraiser_id: taskForm.fundraiser_id ? Number(taskForm.fundraiser_id) : null, due_at: taskForm.due_at ? new Date(taskForm.due_at).toISOString() : null }) }); setTaskForm({ title: '', description: '', fundraiser_id: '', due_at: '' }); onToast('Volunteer task created.'); load(); } catch (error) { onToast(error.message); } };
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">RAISE TOGETHER</span><h2>Fundraisers with momentum.</h2><p>Track targets, progress, and the work assigned to volunteers.</p></div></div>{user && <><form className="club-form" onSubmit={create}><h3>Plan a fundraiser</h3><label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows="2" /></label><label>Target amount<input type="number" min="0" step="0.01" value={form.target_amount} onChange={(event) => setForm({ ...form, target_amount: event.target.value })} /></label><button className="button">Create fundraiser ↗</button></form><form className="club-form" onSubmit={createTask}><h3>Split the work</h3><label>Task<input value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} required /></label><label>Description<textarea value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} rows="2" /></label><div className="form-two-col"><label>Fundraiser<select value={taskForm.fundraiser_id} onChange={(event) => setTaskForm({ ...taskForm, fundraiser_id: event.target.value })}><option value="">General volunteer task</option>{fundraisers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Due<input type="datetime-local" value={taskForm.due_at} onChange={(event) => setTaskForm({ ...taskForm, due_at: event.target.value })} /></label></div><button className="button">Create task ↗</button></form></>}<div className="club-grid">{fundraisers.map((item) => <article className="club-card" key={item.id}><span className="community-badge orange">{item.status}</span><h3>{item.name}</h3><p>{item.description || 'No description provided.'}</p><footer><span>{money(item.total_raised)} raised</span><strong>{item.target_amount ? `of ${money(item.target_amount)}` : 'No target'}</strong></footer></article>)}</div>{user && <><div className="club-section-heading"><span className="topbar-kicker">YOUR VOLUNTEER QUEUE</span><h2>What needs doing.</h2></div><div className="club-request-list">{tasks.length ? tasks.map((task) => <div className="club-request" key={task.id}><div><strong>{task.title}</strong><span>{task.due_at ? dateLabel(task.due_at) : 'No due date'}</span></div><b className={`request-status ${task.status}`}>{task.status}</b></div>) : <div className="state-message">No tasks are assigned to you.</div>}</div></>}</section>;
}

function FinancesPage({ onToast }) {
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  useEffect(() => { Promise.all([request('/financial-reports/summary'), request('/financial-reports/transactions?limit=50')]).then(([report, ledger]) => { setSummary(report.summary); setTransactions(ledger.transactions || []); }).catch((error) => onToast(error.message)); }, []);
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">TREASURY</span><h2>Know where the money went.</h2><p>Income, expenses, reimbursements, and the current ledger in one view.</p></div></div>{summary ? <div className="stat-grid"><Stat label="Total inflows" value={money(summary.total_inflows)} note="all recorded income" /><Stat label="Operating income" value={money(summary.operating_income)} note="dues, tickets, merch, fundraisers" /><Stat label="Approved expenses" value={money(summary.approved_expenses)} note="recorded outflows" /><Stat label="Reimbursements" value={money(summary.reimbursements_paid)} note="paid back to volunteers" /></div> : <div className="state-message">Loading financial summary...</div>}<div className="club-section-heading"><span className="topbar-kicker">LATEST TRANSACTIONS</span><h2>Recent activity</h2></div><div className="club-request-list">{transactions.length ? transactions.map((item) => <div className="club-request" key={item.id}><div><strong>{item.description || item.transaction_type}</strong><span>{item.transaction_date} · {item.source_type || 'ledger'}</span></div><b className={`request-status ${item.direction}`}>{item.direction === 'inflow' ? '+' : '-'}{money(item.amount)}</b></div>) : <div className="state-message">No transactions have been recorded yet.</div>}</div></section>;
}

function ExpensesPage({ onToast }) {
  const [expenses, setExpenses] = useState([]);
  const [form, setForm] = useState({ description: '', amount: '', expense_date: '', receipt_url: '' });
  const load = async () => { try { setExpenses((await request('/expenses/me')).expenses || []); } catch (error) { onToast(error.message); } };
  useEffect(() => { load(); }, []);
  const submit = async (event) => { event.preventDefault(); try { await request('/expenses', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), expense_date: form.expense_date || undefined, receipt_url: form.receipt_url || undefined }) }); setForm({ description: '', amount: '', expense_date: '', receipt_url: '' }); onToast('Expense submitted for review.'); load(); } catch (error) { onToast(error.message); } };
  return <section className="workspace-section"><div className="workspace-heading"><div><span className="topbar-kicker">REIMBURSEMENTS</span><h2>Submit once, keep the receipt trail.</h2><p>Record volunteer spending and follow its review and reimbursement status.</p></div></div><form className="club-form" onSubmit={submit}><h3>Submit an expense</h3><label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></label><div className="form-two-col"><label>Amount<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label><label>Date<input type="date" value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} /></label></div><label>Receipt URL <small>Optional link to a scanned receipt</small><input type="url" value={form.receipt_url} onChange={(event) => setForm({ ...form, receipt_url: event.target.value })} /></label><button className="button">Submit expense ↗</button></form><div className="club-section-heading"><span className="topbar-kicker">YOUR SUBMISSIONS</span><h2>Review status</h2></div><div className="club-request-list">{expenses.length ? expenses.map((item) => <div className="club-request" key={item.id}><div><strong>{item.description}</strong><span>{money(item.amount)} · {item.expense_date}{item.receipt_url ? ' · receipt attached' : ''}</span></div><b className={`request-status ${item.status}`}>{item.status}</b></div>) : <div className="state-message">You have not submitted any expenses.</div>}</div></section>;
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

function EventsPage({ events, loading, onSelect, onRefresh }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => events.filter((event) => `${event.title} ${event.description} ${event.location} ${event.club_name}`.toLowerCase().includes(query.toLowerCase())).filter((event) => filter === 'all' || (filter === 'upcoming' && new Date(event.starts_at) >= new Date())), [events, query, filter]);
  return <section className="workspace-section"><div className="toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events, clubs, or locations..." /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All published events</option><option value="upcoming">Upcoming published events</option></select><button className="link-button" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh events ↻'}</button></div>{loading ? <div className="state-message">Loading events...</div> : filtered.length ? <div className="event-list-grid">{filtered.map((event) => <article className="workspace-event-card" key={event.id} onClick={() => onSelect(event)}><div className="event-card-top"><span className="date-chip">{dateLabel(event.starts_at)}</span><span className="status-pill">{event.status}</span></div><h3>{event.title}</h3><p>{event.description || 'No description was provided for this event.'}</p><div className="event-card-footer"><span>♣ {event.club_name || 'Independent event'}</span><span>⌖ {event.location || 'Location not provided'}</span></div></article>)}</div> : <div className="state-message">No published events match your current search or filter.</div>}</section>;
}

function EventRow({ event }) { return <article className="event-row"><span className="date-block"><strong>{new Date(event.starts_at).getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(event.starts_at))}</small></span><div><h3>{event.title}</h3><p>{event.club_name || 'Independent event'} · {timeLabel(event.starts_at)} · {event.location || 'Campus'}</p></div><span className="row-arrow">↗</span></article>; }

function PeoplePage({ users, loading }) { return <section className="workspace-section"><div className="people-intro"><p>People returned by the users API.</p><span>{users.length} users returned</span></div>{loading ? <div className="state-message">Loading people...</div> : <div className="people-grid">{users.map((person) => <article className="person-card" key={person.id}><span className="person-avatar">{person.name?.slice(0, 1).toUpperCase()}</span><h3>{person.name}</h3><p>{person.email}</p><span className="role-tag">{person.role || 'Role not returned'}</span><small className={person.is_active ? 'active-text' : 'inactive-text'}>{person.is_active ? 'Active' : 'Inactive'}</small></article>)}</div>}</section>; }

function ProfilePage({ user }) { return <section className="profile-card"><div className="profile-hero"><span className="profile-avatar">{user.name?.slice(0, 1).toUpperCase()}</span><div><span className="topbar-kicker">MEMBER PROFILE</span><h2>{user.name}</h2><p>{user.email}</p></div></div><div className="profile-details"><div><span>Account ID</span><strong>#{user.id}</strong></div><div><span>Roles</span><strong>{user.roles?.join(' · ') || 'STUDENT'}</strong></div><div><span>Status</span><strong className="active-text">Active member</strong></div></div></section>; }

function ManagePage({ events, clubs, allowIndependent, onNew, onEdit, onDelete }) { return <section className="workspace-section"><div className="manage-heading"><div><p>Create and maintain events and ticket sales for approved clubs.</p></div><button className="button" onClick={onNew} disabled={!clubs.length && !allowIndependent}>Create event ↗</button></div><div className="manage-table"><div className="table-head"><span>Event</span><span>Club / schedule</span><span>Status</span><span>Action</span></div>{events.map((event) => <div className="table-row" key={event.id}><strong>{event.title}</strong><span>{event.club_name || 'Independent event'}<small>{dateLabel(event.starts_at)} · {timeLabel(event.starts_at)}</small></span><span className="status-pill">{event.status}</span><span><button className="link-button" onClick={() => onEdit(event)}>Edit ↗</button><button className="link-button danger-link" onClick={() => onDelete(event)}>Delete</button></span></div>)}</div>{!clubs.length && !allowIndependent && <div className="state-message">No approved club is available for event creation.</div>}</section>; }

function EventModal({ event, user, onClose, onLogin, onToast }) { return <div className="modal-backdrop" onClick={(click) => click.target === click.currentTarget && onClose()}><section className="event-detail-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}>×</button><span className="detail-eyebrow">EVENT DETAILS</span><h2>{event.title}</h2><div className="detail-meta"><span>{event.club_name || 'Independent event'}</span><span>{dateLabel(event.starts_at)}</span><span>{timeLabel(event.starts_at)}</span><span>{event.location || 'Location not provided'}</span></div><p id="event-detail-description">{event.description || 'No description was provided for this event.'}</p><TicketBooking event={event} user={user} onLogin={onLogin} onToast={onToast} /><div className="detail-actions"><button className="link-button" onClick={onClose}>Close</button></div></section></div>; }

function TicketBooking({ event, user, onLogin, onToast }) {
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
    const cards = booking.tickets.map((item) => `<article><h1>${event.title}</h1><p>${event.club_name || 'Independent event'}</p><p>${dateLabel(event.starts_at)} · ${timeLabel(event.starts_at)}</p><hr><strong>Ticket code</strong><code>${item.ticket_code}</code><p>Price paid: ${item.price_paid}</p></article>`).join('');
    printWindow.document.write(`<html><head><title>Tickets - ${event.title}</title><style>body{font-family:Arial;padding:24px}article{border:2px solid #102a43;padding:24px;margin:0 0 20px;max-width:600px}h1{color:#102a43}code{display:block;font-size:20px;margin-top:10px;word-break:break-all}</style></head><body>${cards}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  return <div className="ticket-booking"><div><strong>{ticket.name}</strong><small>{ticket.is_member ? 'Club member price' : 'Non-club member price'}: {unitPrice.toFixed(2)}</small><small>{ticket.remaining} spots remaining · Total: {(unitPrice * Number(quantity || 0)).toFixed(2)}</small></div><div className="ticket-booking-actions">{booking ? <button className="button button-small" onClick={printTickets}>Print ticket ↗</button> : <><input type="number" min="1" max={Math.min(10, ticket.remaining)} value={quantity} onChange={(input) => setQuantity(input.target.value)} disabled={!ticket.remaining} /><button className="button button-small" onClick={book} disabled={!ticket.remaining}>Book ticket ↗</button></>}</div></div>;
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
  return <div className="modal-backdrop"><section className="auth-modal editor-modal"><button className="modal-close" onClick={onClose}>×</button><span className="detail-eyebrow">{event.id ? 'EDIT EVENT' : 'NEW EVENT'}</span><h2>{event.id ? 'Shape the next gathering.' : 'Create a moment.'}</h2><form onSubmit={(submitEvent) => { submitEvent.preventDefault(); onSave(event); }}><label>Club<select value={event.club_id || ''} onChange={(input) => update('club_id', input.target.value ? Number(input.target.value) : null)} required={!event.id && !allowIndependent}><option value="">{allowIndependent ? 'Independent event' : 'Select an approved club'}</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label><label>Title<input value={event.title} onChange={(input) => update('title', input.target.value)} required /></label><label>Description<textarea value={event.description || ''} onChange={(input) => update('description', input.target.value)} rows="3" /></label><label>Location<input value={event.location || ''} onChange={(input) => update('location', input.target.value)} /></label><div className="form-two-col"><label>Starts<input type="datetime-local" value={event.starts_at?.slice(0, 16) || ''} onChange={(input) => update('starts_at', input.target.value)} required /></label><label>Ends<input type="datetime-local" value={event.ends_at?.slice(0, 16) || ''} onChange={(input) => update('ends_at', input.target.value)} required /></label></div><div className="form-two-col"><label>Ticket name<input value={event.ticket_name || ''} onChange={(input) => update('ticket_name', input.target.value)} required /></label><label>Tickets available<input type="number" min="0" value={event.quantity_available ?? 0} onChange={(input) => update('quantity_available', input.target.value)} required /></label></div><div className="form-two-col"><label>Member price<input type="number" min="0" step="0.01" value={event.member_price ?? 0} onChange={(input) => update('member_price', input.target.value)} required /></label><label>Non-member price<input type="number" min="0" step="0.01" value={event.non_member_price ?? 0} onChange={(input) => update('non_member_price', input.target.value)} required /></label></div>{event.id && <label>Status<select value={event.status || 'published'} onChange={(input) => update('status', input.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></label>}<button className="button button-full">Save event and tickets ↗</button></form></section></div>;
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
  return <div className="modal-backdrop"><section className="auth-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}>×</button><span className="auth-kicker">GATHER ACCOUNT</span><h2>{register ? 'Create your account' : 'Welcome back'}</h2><p>{register ? 'Create an account to manage events, clubs, tickets, and membership.' : 'Sign in to access your campus workspace.'}</p><div className="auth-tabs"><button className={`auth-tab ${register ? 'active' : ''}`} onClick={() => setMode('register')}>Create account</button><button className={`auth-tab ${!register ? 'active' : ''}`} onClick={() => setMode('login')}>Sign in</button></div><form onSubmit={submit}>{register && <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>}<label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>Password<input type="password" minLength="6" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label><button className="button button-full" disabled={submitting}>{submitting ? 'Signing in...' : register ? 'Create account' : 'Sign in'}</button>{message && <div className="form-message">{message}</div>}</form></section></div>;
}

createRoot(document.getElementById('root')).render(<App />);
