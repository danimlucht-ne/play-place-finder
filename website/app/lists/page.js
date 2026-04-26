'use client';

import { useEffect, useState } from 'react';
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
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedList, setSelectedList] = useState(null);
  const [renameValue, setRenameValue] = useState('');

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

  async function openListDetail(listId) {
    setSelectedListId(listId);
    setError('');
    try {
      const response = await webFetch(`/api/lists/detail/${encodeURIComponent(listId)}`);
      setSelectedList(response.data || null);
      setRenameValue(response.data?.name || '');
    } catch (err) {
      setError(err.message || 'Could not load list details.');
    }
  }

  async function renameList() {
    if (!selectedListId || !renameValue.trim()) return;
    setSaveBusy(true);
    setError('');
    setMessage('');
    try {
      await webFetch(`/api/lists/${encodeURIComponent(selectedListId)}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      setMessage('List renamed.');
      await loadLists();
      await openListDetail(selectedListId);
    } catch (err) {
      setError(err.message || 'Could not rename list.');
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
      if (selectedListId === listId) {
        setSelectedListId('');
        setSelectedList(null);
      }
      await loadLists();
    } catch (err) {
      setError(err.message || 'Could not delete list.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function removeFromList(placeId) {
    if (!selectedListId) return;
    setSaveBusy(true);
    setError('');
    setMessage('');
    try {
      await webFetch(`/api/lists/${encodeURIComponent(selectedListId)}/remove`, {
        method: 'PUT',
        body: JSON.stringify({ placeId }),
      });
      setMessage('Removed from list.');
      await loadLists();
      await openListDetail(selectedListId);
    } catch (err) {
      setError(err.message || 'Could not remove place from list.');
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
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => openListDetail(list.id)}>
                    View places
                  </button>
                  <button type="button" className="btn btn-outline hub-btn-dark" disabled={saveBusy} onClick={() => deleteList(list.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {!busy && lists.length === 0 && !error ? <p className="hub-empty">No lists yet.</p> : null}
          </div>
          {selectedList ? (
            <div className="hub-detail-card">
              <h3>{selectedList.name || 'List detail'}</h3>
              <p className="hub-muted-copy">List id: {selectedListId}</p>
              <div className="hub-actions-inline" style={{ marginBottom: '12px' }}>
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={20} />
                <button type="button" className="btn btn-outline hub-btn-dark" disabled={saveBusy} onClick={renameList}>
                  Rename list
                </button>
              </div>
              <div className="hub-list">
                {(selectedList.places || []).map((place) => (
                  <article className="hub-list-card" key={place._id}>
                    <h4>{place.name || 'Unnamed place'}</h4>
                    <p>{[place.city, place.state].filter(Boolean).join(', ') || 'Location unavailable'}</p>
                    <div className="hub-actions-inline">
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
              </div>
            </div>
          ) : null}
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
