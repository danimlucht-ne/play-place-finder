'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthGate from './AuthGate';
import ConsumerPageFrame from './ConsumerPageFrame';
import { webFetch } from './webAuthClient';

export default function ListDetailClient({ listId }) {
  const [busy, setBusy] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [list, setList] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  async function loadDetail() {
    if (!listId) return;
    setBusy(true);
    setError('');
    try {
      const response = await webFetch(`/api/lists/detail/${encodeURIComponent(listId)}`);
      const next = response.data || null;
      setList(next);
      setRenameValue(next?.name || '');
    } catch (err) {
      setError(err.message || 'Could not load list details.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [listId]);

  async function renameList() {
    if (!listId || !renameValue.trim()) return;
    setSaveBusy(true);
    setError('');
    setMessage('');
    try {
      await webFetch(`/api/lists/${encodeURIComponent(listId)}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      setMessage('List renamed.');
      await loadDetail();
    } catch (err) {
      setError(err.message || 'Could not rename list.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function removeFromList(placeId) {
    if (!listId) return;
    setSaveBusy(true);
    setError('');
    setMessage('');
    try {
      await webFetch(`/api/lists/${encodeURIComponent(listId)}/remove`, {
        method: 'PUT',
        body: JSON.stringify({ placeId }),
      });
      setMessage('Removed from list.');
      await loadDetail();
    } catch (err) {
      setError(err.message || 'Could not remove place from list.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteList() {
    if (!listId) return;
    setSaveBusy(true);
    setError('');
    setMessage('');
    try {
      await webFetch(`/api/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
      setMessage('List deleted. Open Saved to continue.');
      setList(null);
    } catch (err) {
      setError(err.message || 'Could not delete list.');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <ConsumerPageFrame
      title="List details"
      subtitle="Manage one saved list: rename, review places, and remove items."
      heroVariant="tall"
    >
      <AuthGate>
        <section className="hub-card">
          <div className="hub-actions-inline" style={{ marginBottom: '12px' }}>
            <Link href="/lists" className="btn btn-outline hub-btn-dark">Back to Saved</Link>
            {list ? (
              <button type="button" className="btn btn-outline hub-btn-dark" disabled={saveBusy} onClick={deleteList}>
                Delete this list
              </button>
            ) : null}
          </div>
          {busy ? <p className="hub-muted-copy">Loading list details…</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          {list ? (
            <div className="hub-detail-card">
              <h3>{list.name || 'List detail'}</h3>
              <p className="hub-muted-copy">List id: {listId}</p>
              <div className="hub-actions-inline" style={{ marginBottom: '12px' }}>
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={20} />
                <button type="button" className="btn btn-outline hub-btn-dark" disabled={saveBusy} onClick={renameList}>
                  Rename list
                </button>
              </div>
              <div className="hub-list">
                {(list.places || []).map((place) => (
                  <article className="hub-list-card" key={place._id}>
                    <h4>{place.name || 'Unnamed place'}</h4>
                    <p>{[place.city, place.state].filter(Boolean).join(', ') || 'Location unavailable'}</p>
                    <div className="hub-actions-inline">
                      <Link className="btn btn-teal" href={`/playground/${encodeURIComponent(place._id)}`}>View place</Link>
                      <button
                        type="button"
                        className="btn btn-outline hub-btn-dark"
                        disabled={saveBusy}
                        onClick={() => removeFromList(place._id)}
                      >
                        Remove from list
                      </button>
                    </div>
                  </article>
                ))}
                {(list.places || []).length === 0 ? <p className="hub-empty">No places in this list yet.</p> : null}
              </div>
            </div>
          ) : null}
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
