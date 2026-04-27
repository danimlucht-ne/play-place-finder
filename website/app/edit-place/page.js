'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AuthGate from '../components/AuthGate';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

const emptyForm = {
  name: '',
  description: '',
  address: '',
  city: '',
  state: '',
  playgroundType: '',
  hasBathrooms: false,
  isToddlerFriendly: false,
};

export default function EditPlacePage() {
  return (
    <Suspense fallback={<ConsumerPageFrame title="Edit place" subtitle="Loading edit form…" />}>
      <EditPlaceInner />
    </Suspense>
  );
}

function EditPlaceInner() {
  const searchParams = useSearchParams();
  const placeId = useMemo(() => searchParams.get('id') || '', [searchParams]);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      if (!placeId) return;
      setBusy(true);
      setError('');
      try {
        const response = await webFetch(`/api/playgrounds/${encodeURIComponent(placeId)}`);
        const place = response.data || {};
        setForm({
          name: place.name || '',
          description: place.description || '',
          address: place.address || '',
          city: place.city || '',
          state: place.state || '',
          playgroundType: place.playgroundType || '',
          hasBathrooms: Boolean(place.hasBathrooms),
          isToddlerFriendly: Boolean(place.isToddlerFriendly),
        });
      } catch (err) {
        setError(err.message || 'Could not load place.');
      } finally {
        setBusy(false);
      }
    }
    load();
  }, [placeId]);

  async function submit(event) {
    event.preventDefault();
    if (!placeId) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await webFetch(`/api/playgrounds/${encodeURIComponent(placeId)}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setMessage(response.message || 'Edit submitted.');
    } catch (err) {
      setError(err.message || 'Could not submit edit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsumerPageFrame
      title="Edit place"
      subtitle="Submit updates for admin review. Approved edits sync back to app and web."
    >
      <AuthGate>
        <section className="hub-card">
          {!placeId ? <p className="hub-muted-copy">Open this page with a place id (from place details).</p> : null}
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
          <form className="hub-form-grid" onSubmit={submit}>
            <label className="hub-field"><span>Name</span><input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} /></label>
            <label className="hub-field"><span>Address</span><input value={form.address} onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))} /></label>
            <label className="hub-field"><span>City</span><input value={form.city} onChange={(e) => setForm((c) => ({ ...c, city: e.target.value }))} /></label>
            <label className="hub-field"><span>State</span><input value={form.state} onChange={(e) => setForm((c) => ({ ...c, state: e.target.value }))} /></label>
            <label className="hub-field"><span>Type</span><input value={form.playgroundType} onChange={(e) => setForm((c) => ({ ...c, playgroundType: e.target.value }))} /></label>
            <label className="hub-field hub-field--full"><span>Description</span><textarea rows={4} value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} /></label>
            <label className="hub-checkbox"><input type="checkbox" checked={form.hasBathrooms} onChange={(e) => setForm((c) => ({ ...c, hasBathrooms: e.target.checked }))} /><span>Has bathrooms</span></label>
            <label className="hub-checkbox"><input type="checkbox" checked={form.isToddlerFriendly} onChange={(e) => setForm((c) => ({ ...c, isToddlerFriendly: e.target.checked }))} /><span>Toddler friendly</span></label>
            <div className="hub-actions-inline hub-field--full">
              <button type="submit" className="btn btn-teal" disabled={busy}>{busy ? 'Submitting…' : 'Submit edit'}</button>
              <Link className="btn btn-outline hub-btn-dark" href={placeId ? `/playground/${encodeURIComponent(placeId)}` : '/discover'}>Back</Link>
            </div>
          </form>
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
