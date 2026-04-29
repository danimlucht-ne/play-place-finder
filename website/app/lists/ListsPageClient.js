'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AuthGate from '../components/AuthGate';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

function ListsPageInner() {
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get('tab') || 'lists').toLowerCase();
  const activeTab = tabParam === 'favorites' ? 'favorites' : 'lists';

  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lists, setLists] = useState([]);
  const [newListName, setNewListName] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

  const [favBusy, setFavBusy] = useState(true);
  const [favError, setFavError] = useState('');
  const [favMessage, setFavMessage] = useState('');
  const [ids, setIds] = useState([]);
  const [places, setPlaces] = useState([]);
  const [actionBusyId, setActionBusyId] = useState('');

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

  async function loadFavorites() {
    setFavBusy(true);
    setFavError('');
    try {
      const response = await webFetch('/api/favorites/me/ids');
      const nextIds = response.data || [];
      setIds(nextIds);
      const details = await Promise.all(
        nextIds.slice(0, 30).map(async (placeId) => {
          try {
            const detail = await webFetch(`/api/playgrounds/${encodeURIComponent(placeId)}`);
            return detail.data || null;
          } catch (_) {
            return { _id: placeId, name: placeId };
          }
        }),
      );
      setPlaces(details.filter(Boolean));
    } catch (err) {
      setFavError(err.message || 'Could not load favorites.');
    } finally {
      setFavBusy(false);
    }
  }

  useEffect(() => {
    loadLists();
  }, []);

  useEffect(() => {
    if (activeTab === 'favorites') {
      loadFavorites();
    }
  }, [activeTab]);

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

  async function removeFavorite(placeId) {
    setActionBusyId(placeId);
    setFavError('');
    setFavMessage('');
    try {
      await webFetch('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ placeId }),
      });
      setFavMessage('Favorite removed.');
      setIds((current) => current.filter((id) => id !== placeId));
      setPlaces((current) => current.filter((place) => place._id !== placeId));
    } catch (err) {
      setFavError(err.message || 'Could not remove favorite.');
    } finally {
      setActionBusyId('');
    }
  }

  return (
    <ConsumerPageFrame
      title="Saved"
      subtitle="Your favorite places and custom lists—same data as the Play Spotter app when you’re signed in."
      heroVariant="tall"
    >
      <AuthGate>
        <div className="saved-tabs" role="tablist" aria-label="Saved content">
          <Link
            href="/lists"
            className={`saved-tabs__btn${activeTab === 'lists' ? ' saved-tabs__btn--active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'lists'}
          >
            Play lists
          </Link>
          <Link
            href="/lists?tab=favorites"
            className={`saved-tabs__btn${activeTab === 'favorites' ? ' saved-tabs__btn--active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'favorites'}
          >
            Favorite places
          </Link>
        </div>

        {activeTab === 'lists' ? (
          <section className="hub-card" style={{ marginTop: '20px' }}>
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
        ) : (
          <section className="hub-card" style={{ marginTop: '20px' }}>
            {favBusy ? <p className="hub-muted-copy">Loading favorites…</p> : null}
            {favError ? <p className="hub-feedback hub-feedback--bad">{favError}</p> : null}
            {favMessage ? <p className="hub-feedback hub-feedback--good">{favMessage}</p> : null}
            {!favBusy && !favError ? (
              <>
                <div className="hub-summary">
                  <div><strong>Favorite count:</strong> {ids.length}</div>
                </div>
                <div className="hub-list">
                  {places.map((place) => (
                    <article className="hub-list-card" key={place._id}>
                      <h3>{place.name || place._id}</h3>
                      <p>{[place.city, place.state].filter(Boolean).join(', ') || 'Location unavailable'}</p>
                      <div className="hub-actions-inline">
                        <Link className="btn btn-teal" href={`/playground/${encodeURIComponent(place._id)}`}>
                          View details
                        </Link>
                        <button
                          type="button"
                          className="btn btn-outline hub-btn-dark"
                          disabled={actionBusyId === place._id}
                          onClick={() => removeFavorite(place._id)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                  {places.length === 0 ? <p className="hub-empty">None yet. Heart places in Discover to save them here.</p> : null}
                </div>
              </>
            ) : null}
          </section>
        )}
      </AuthGate>
    </ConsumerPageFrame>
  );
}

export default function ListsPageClient() {
  return (
    <Suspense
      fallback={(
        <ConsumerPageFrame title="Saved" subtitle="Loading…" heroVariant="tall">
          <p className="hub-muted-copy" style={{ padding: '24px 0' }}>Loading your saved content…</p>
        </ConsumerPageFrame>
      )}
    >
      <ListsPageInner />
    </Suspense>
  );
}
