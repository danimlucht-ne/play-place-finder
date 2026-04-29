'use client';

import { useState } from 'react';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

const initialForm = {
  ticketType: 'GENERAL',
  category: '',
  targetKind: '',
  targetId: '',
  suggestionCategory: '',
  suggestionLabel: '',
  email: '',
  message: '',
};

export default function SupportPage() {
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
      await webFetch('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          ticketType: form.ticketType,
          category: form.category || null,
          message: `Email: ${form.email}\n\n${form.message}`.trim(),
          targetKind: form.targetKind || null,
          targetId: form.targetId || null,
          suggestionCategory: form.ticketType === 'SUGGESTION' ? form.suggestionCategory : null,
          suggestionLabel: form.ticketType === 'SUGGESTION' ? form.suggestionLabel : null,
        }),
      });
      setMessage('Support ticket submitted.');
      setForm(initialForm);
    } catch (err) {
      setError(err.message || 'Could not submit support ticket.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsumerPageFrame
      title="Support"
      subtitle="Send issues, suggestions, and support tickets to the same queue we use in the app."
      heroVariant="tall"
    >
      <section className="hub-card">
        <form className="hub-form-grid" onSubmit={submit}>
          <label className="hub-field">
            <span>Request type</span>
            <select value={form.ticketType} onChange={(event) => setForm((current) => ({ ...current, ticketType: event.target.value }))}>
              <option value="GENERAL">General question</option>
              <option value="CONTENT_ISSUE">Content issue</option>
              <option value="AD_INQUIRY">Ad inquiry</option>
              <option value="ACCOUNT">Account</option>
              <option value="BUG">Bug</option>
              <option value="SUGGESTION">Suggestion</option>
            </select>
          </label>
          <label className="hub-field">
            <span>Category (optional)</span>
            <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
          </label>
          <label className="hub-field">
            <span>Email</span>
            <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
          </label>
          <label className="hub-field">
            <span>Target kind (optional)</span>
            <select value={form.targetKind} onChange={(event) => setForm((current) => ({ ...current, targetKind: event.target.value }))}>
              <option value="">None</option>
              <option value="playground">Playground</option>
              <option value="subVenue">Sub-venue</option>
            </select>
          </label>
          <label className="hub-field">
            <span>Target id (optional)</span>
            <input value={form.targetId} onChange={(event) => setForm((current) => ({ ...current, targetId: event.target.value }))} />
          </label>
          {form.ticketType === 'SUGGESTION' ? (
            <>
              <label className="hub-field">
                <span>Suggestion category</span>
                <select value={form.suggestionCategory} onChange={(event) => setForm((current) => ({ ...current, suggestionCategory: event.target.value }))}>
                  <option value="">Select</option>
                  <option value="ground_type">Ground type</option>
                  <option value="equipment">Equipment</option>
                  <option value="atmosphere">Atmosphere</option>
                  <option value="custom_amenity">Custom amenity</option>
                </select>
              </label>
              <label className="hub-field">
                <span>Suggestion label</span>
                <input value={form.suggestionLabel} onChange={(event) => setForm((current) => ({ ...current, suggestionLabel: event.target.value }))} />
              </label>
            </>
          ) : null}
          <label className="hub-field hub-field--full">
            <span>Message</span>
            <textarea rows={5} value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} required />
          </label>
          <div className="hub-actions-inline hub-field--full">
            <button type="submit" className="btn btn-teal" disabled={busy}>{busy ? 'Sending…' : 'Submit ticket'}</button>
          </div>
        </form>
        {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
      </section>
    </ConsumerPageFrame>
  );
}
