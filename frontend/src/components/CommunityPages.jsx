import React, { useEffect, useState } from 'react';
import { request } from '../lib.js';

export function ClubsPage({ clubs, myClubs, user, onCreated, onToast, onLogin, onManage }) {
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
    <div className="manage-heading"><div><p>Discover approved clubs and submit your own club for approval.</p></div>{user ? <button className="button" onClick={() => setFormOpen((open) => !open)}>Create a club ?</button> : <button className="button" onClick={onLogin}>Log in to create a club ?</button>}</div>
    {formOpen && <form className="club-form" onSubmit={submit}><h2>Submit a club request</h2><p>The main admin must approve the club before its lead can create events.</p><label>Club name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Technology, culture, service..." required /></label><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} minLength="10" rows="4" required /></label><button className="button">Submit for approval ?</button></form>}
    <div className="club-section-heading"><span className="topbar-kicker">APPROVED CLUBS</span><h2>Find your circle.</h2></div>
    {clubs.length ? <div className="club-grid">{clubs.map((club) => <article className="club-card" key={club.id}><span className="community-badge mint">{club.category}</span><h3>{club.name}</h3><p>{club.description}</p><footer><span>{club.member_count} members</span><span>Approved</span></footer></article>)}</div> : <div className="state-message">No approved clubs have been published yet.</div>}
    {user && <><div className="club-section-heading"><span className="topbar-kicker">YOUR CLUB REQUESTS</span><h2>Application status.</h2></div>{myClubs.length ? <div className="club-request-list">{myClubs.map((club) => <div className="club-request" key={club.id}><div><strong>{club.name}</strong><span>{club.category}</span></div><b className={`request-status ${club.status}`}>{club.status}</b>{club.status === 'approved' && ['lead', 'admin'].includes(club.role) && <button className="link-button" onClick={onManage}>Manage club ?</button>}</div>)}</div> : <div className="state-message">You have not submitted a club request.</div>}</>}
  </section>;
}

export function ClubApprovals({ onChanged, onToast }) {
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
