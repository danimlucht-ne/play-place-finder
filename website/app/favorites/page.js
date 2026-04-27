'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '../components/AuthGate';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

export default function FavoritesPage() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [ids, setIds] = useState([]);
  const [places, setPlaces] = useState([]);
  const [actionBusyId, setActionBusyId] = useState('');

  async function loadFavorites() {
    setBusy(true);
    setError('');
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
      setError(err.message || 'Could not load favorites.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadFavorites();
  }, []);

  async function removeFavorite(placeId) {
    setActionBusyId(placeId);
    setError('');
    setMessage('');
    try {
      await webFetch('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ placeId }),
      });
      setMessage('Favorite removed.');
      setIds((current) => current.filter((id) => id !== placeId));
      setPlaces((current) => current.filter((place) => place._id !== placeId));
    } catch (err) {
      setError(err.message || 'Could not remove favorite.');
    } finally {
      setActionBusyId('');
    }
  }

  return (
    <ConsumerPageFrame
      title="Favorites"
      subtitle="Signed-in parity for favorite place IDs shared across app and web."
    >
      <AuthGate>
        <section className="hub-card">
          {busy ? <p className="hub-muted-copy">Loading favorites…</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          {!busy && !error ? (
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
                      <Link className="btn btn-teal" href={`/playground/${encodeURIComponent(place._id)}`}>View details</Link>
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
                {places.length === 0 ? <p className="hub-empty">None yet.</p> : null}
              </div>
            </>
          ) : null}
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
