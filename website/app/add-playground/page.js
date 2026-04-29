'use client';

import { useState } from 'react';
import AuthGate from '../components/AuthGate';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

const initialForm = {
  name: '',
  description: '',
  address: '',
  city: '',
  state: '',
};

export default function AddPlaygroundPage() {
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await webFetch('/api/playgrounds', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setMessage('Submission sent for review.');
      setForm(initialForm);
    } catch (err) {
      setError(err.message || 'Could not submit playground.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsumerPageFrame
      title="Suggest a new place"
      subtitle="Contribute a new playground or site from the web with the same moderation flow as the app."
      heroVariant="tall"
    >
      <AuthGate>
        <section className="hub-card">
          <form className="hub-form-grid" onSubmit={submit}>
            <label className="hub-field">
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="hub-field">
              <span>Address</span>
              <input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>City</span>
              <input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>State</span>
              <input value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))} />
            </label>
            <label className="hub-field hub-field--full">
              <span>Description</span>
              <textarea rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <div className="hub-actions-inline hub-field--full">
              <button type="submit" className="btn btn-teal" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
            </div>
          </form>
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
