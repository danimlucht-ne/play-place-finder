'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '../components/AuthGate';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

export default function ListsPage() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lists, setLists] = useState([]);
  const [newListName, setNewListName] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

  async function loadLists() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await webFetch('/api/lists');
      setLists(response.data || []);
    } catch (err) {
      setError(err.message || 'Could not load lists.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadLists();
  }, []);

  async function createList(event) {
    event.preventDefault();
    if (!newListName.trim()) return;
    setSaveBusy(true);
    setError('');
    try {
      await webFetch('/api/lists', {
        method: 'POST',
        body: JSON.stringify({ name: newListName.trim() }),
      });
      setNewListName('');
      await loadLists();
    } catch (err) {
      setError(err.message || 'Could not create list.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteList(listId) {
    setSaveBusy(true);
    setError('');
    setMessage('');
    try {
      await webFetch(`/api/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
      setMessage('List deleted.');
      await loadLists();
    } catch (err) {
      setError(err.message || 'Could not delete list.');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <ConsumerPageFrame
      title="Saved lists"
      subtitle="Playlist/list parity surface for organizing places by trip type and family routines."
    >
      <AuthGate>
        <section className="hub-card">
          <form className="hub-actions-inline" onSubmit={createList} style={{ marginBottom: '16px' }}>
            <input
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="Create new list"
              maxLength={20}
            />
            <button type="submit" className="btn btn-teal" disabled={saveBusy}>
              {saveBusy ? 'Creating…' : 'Create list'}
            </button>
          </form>
          {busy ? <p className="hub-muted-copy">Loading lists…</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          <div className="hub-list">
            {lists.map((list) => (
              <article key={list.id} className="hub-list-card">
                <h3>{list.name || 'Untitled list'}</h3>
                <p>{list.placeCount || 0} saved places</p>
                <div className="hub-actions-inline">
                  <Link className="btn btn-outline hub-btn-dark" href={`/lists/${encodeURIComponent(list.id)}`}>
                    View places
                  </Link>
                  <button type="button" className="btn btn-outline hub-btn-dark" disabled={saveBusy} onClick={() => deleteList(list.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {!busy && lists.length === 0 && !error ? <p className="hub-empty">No lists yet.</p> : null}
          </div>
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
