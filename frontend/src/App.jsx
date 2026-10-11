import React, { useEffect, useState } from 'react';
import { request, emptyEvent } from './lib.js';
import { AuthModal } from './components/AuthModal.jsx';
import { EventEditor, EventModal } from './components/EventComponents.jsx';
import { AnnouncementsPage, CheckInPage, ExpensesPage, FinancesPage, FundraisersPage, MembershipPage, MerchandisePage, MyTicketsPage } from './components/OperationsPages.jsx';
import { ClubApprovals, ClubsPage } from './components/CommunityPages.jsx';
import { Dashboard, EventsPage, ManagePage, PeoplePage, ProfilePage } from './components/CorePages.jsx';
import { NavItem } from './components/OperationsPages.jsx';

export default function App() {
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
          <NavItem active={page === 'dashboard'} icon="O" label="Overview" onClick={() => navigate('dashboard')} />
          <NavItem active={page === 'events'} icon="E" label="Events" onClick={() => navigate('events')} />
          <NavItem active={page === 'clubs'} icon="C" label="Clubs" onClick={() => navigate('clubs')} />
          <NavItem active={page === 'people'} icon="P" label="People" onClick={() => navigate('people')} />
          <NavItem active={page === 'membership'} icon="M" label="Membership" onClick={() => navigate('membership')} />
          {user && <NavItem active={page === 'tickets'} icon="T" label="My tickets" onClick={() => navigate('tickets')} />}
          <NavItem active={page === 'announcements'} icon="A" label="Announcements" onClick={() => navigate('announcements')} />
          <NavItem active={page === 'merchandise'} icon="S" label="Merchandise" onClick={() => navigate('merchandise')} />
          <NavItem active={page === 'fundraisers'} icon="F" label="Fundraisers" onClick={() => navigate('fundraisers')} />
          {user && <NavItem active={page === 'expenses'} icon="X" label="Expenses" onClick={() => navigate('expenses')} />}
          {user && <NavItem active={page === 'finances'} icon="$" label="Finances" onClick={() => navigate('finances')} />}
          {canManageEvents && <NavItem active={page === 'manage'} icon="G" label="Manage events" onClick={() => navigate('manage')} />}
          {canManageEvents && <NavItem active={page === 'checkin'} icon="K" label="Check-in" onClick={() => navigate('checkin')} />}
          {isAdmin && <NavItem active={page === 'approvals'} icon="R" label="Club approvals" onClick={() => navigate('approvals')} />}
          <NavItem active={page === 'profile'} icon="P" label="Profile" onClick={() => navigate('profile')} />
        </nav>
        <div className="sidebar-bottom">{!user && <button className="button button-small" onClick={() => setAuthMode('login')}>Log in to Gather</button>}</div>
      </aside>
      <main className="app-main">
        <header className="app-topbar"><div><span className="topbar-kicker">GATHER / {page.toUpperCase()}</span><h1>{pageTitle}</h1></div><div className="topbar-actions">{user ? <><div className="topbar-user"><span className="user-avatar">{user.name?.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.roles?.[0] || 'STUDENT'}</small></div></div><button className="topbar-profile" onClick={() => navigate('profile')}>Profile</button><button className="topbar-logout" onClick={logout}>Log out</button></> : <button className="button button-small" onClick={() => setAuthMode('register')}>Join Gather <span>?</span></button>}</div></header>
        {!user && page !== 'dashboard' && <div className="auth-required state-message">Log in to access your community workspace. <button className="link-button" onClick={() => setAuthMode('login')}>Log in ?</button></div>}
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
