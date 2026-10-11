import React, { useState } from 'react';
import { request } from '../lib.js';

export function AuthModal({ mode, onClose, onSuccess, setMode }) {
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

