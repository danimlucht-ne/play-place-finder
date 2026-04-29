'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { WEB_AUTH_EVENT, getAuthToken, webFetch } from '../components/webAuthClient';

export default function DiscoverPage() {
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [places, setPlaces] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [favBusyId, setFavBusyId] = useState('');
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [playgroundType, setPlaygroundType] = useState('all');
  const [hasBathrooms, setHasBathrooms] = useState(false);
  const [isToddlerFriendly, setIsToddlerFriendly] = useState(false);
  const [sortBy, setSortBy] = useState('newest');
  const [usingSearchEndpoint, setUsingSearchEndpoint] = useState(false);

  const playgroundTypes = [
    'all',
    'Playground',
    'Indoor Play Center',
    'Park',
    'Splash Pad',
    'Library',
  ];

  function sortPlaces(rows) {
    const copy = [...rows];
    if (sortBy === 'name') {
      return copy.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }
    if (sortBy === 'rating') {
      return copy.sort((a, b) => Number(b.averageRating || 0) - Number(a.averageRating || 0));
    }
    return copy;
  }

  async function loadFavorites() {
    if (!getAuthToken()) {
      setFavoriteIds([]);
      return;
    }
    const favoritesResponse = await webFetch('/api/favorites/me/ids').catch(() => ({ data: [] }));
    setFavoriteIds(favoritesResponse.data || []);
  }

  async function loadDiscover() {
    setBusy(true);
    setError('');
    try {
      const shouldUseSearch = playgroundType !== 'all' || hasBathrooms || isToddlerFriendly;
      setUsingSearchEndpoint(shouldUseSearch);
      if (shouldUseSearch) {
        const params = new URLSearchParams();
        if (playgroundType !== 'all') params.set('playgroundType', playgroundType);
        if (hasBathrooms) params.set('hasBathrooms', 'true');
        if (isToddlerFriendly) params.set('isToddlerFriendly', 'true');
        const response = await webFetch(`/api/playgrounds/search?${params.toString()}`);
        setPlaces(sortPlaces(response.data || []));
        setCursor('');
        setHasMore(false);
      } else {
        const response = await webFetch('/api/playgrounds?limit=40');
        setPlaces(sortPlaces(response.data || []));
        setCursor(response.nextCursor || '');
        setHasMore(Boolean(response.nextCursor));
      }
      await loadFavorites();
    } catch (err) {
      setError(err.message || 'Could not load places.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadDiscover();
  }, [playgroundType, hasBathrooms, isToddlerFriendly, sortBy]);

  useEffect(() => {
    function refreshFavorites() {
      loadFavorites();
    }
    window.addEventListener(WEB_AUTH_EVENT, refreshFavorites);
    window.addEventListener('storage', refreshFavorites);
    return () => {
      window.removeEventListener(WEB_AUTH_EVENT, refreshFavorites);
      window.removeEventListener('storage', refreshFavorites);
    };
  }, []);

  async function loadMore() {
    if (!cursor || usingSearchEndpoint) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await webFetch(`/api/playgrounds?limit=40&cursor=${encodeURIComponent(cursor)}`);
      const nextRows = response.data || [];
      setPlaces((current) => sortPlaces([...current, ...nextRows]));
      setCursor(response.nextCursor || '');
      setHasMore(Boolean(response.nextCursor));
    } catch (err) {
      setError(err.message || 'Could not load more places.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFavorite(placeId) {
    if (!getAuthToken()) {
      setError('Sign in from Account to save places to your favorites.');
      return;
    }
    setFavBusyId(placeId);
    setError('');
    try {
      await webFetch('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ placeId }),
      });
      setFavoriteIds((current) => (
        current.includes(placeId) ? current.filter((id) => id !== placeId) : [...current, placeId]
      ));
    } catch (err) {
      setError(err.message || 'Could not update favorite.');
    } finally {
      setFavBusyId('');
    }
  }

  const visiblePlaces = places.filter((place) => {
    const query = nameQuery.trim().toLowerCase();
    if (!query) return true;
    return [place.name, place.city, place.state, place.address]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return (
    <ConsumerPageFrame
      title="Discover play places"
      subtitle="Browse the same community-powered places you see in the app—search, filter, and open a place for full details."
      heroVariant="tall"
    >
      <section className="hub-card">
        <div className="hub-card-head">
          <div>
            <h2>All sites</h2>
            <p>Showing the latest available places from the shared API.</p>
          </div>
          <div className="hub-actions-inline">
            <Link href="/map" className="btn btn-outline hub-btn-dark">Map view</Link>
            <Link href="/events" className="btn btn-outline hub-btn-dark">Events</Link>
          </div>
        </div>
        <div className="hub-actions-inline" style={{ marginBottom: '12px', flexWrap: 'wrap' }}>
          <input
            value={nameQuery}
            onChange={(event) => setNameQuery(event.target.value)}
            placeholder="Search by name/city/address"
          />
          <select value={playgroundType} onChange={(event) => setPlaygroundType(event.target.value)}>
            {playgroundTypes.map((type) => (
              <option key={type} value={type}>{type === 'all' ? 'All types' : type}</option>
            ))}
          </select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="rating">Top rated</option>
          </select>
          <label className="hub-checkbox">
            <input type="checkbox" checked={hasBathrooms} onChange={(event) => setHasBathrooms(event.target.checked)} />
            <span>Bathrooms</span>
          </label>
          <label className="hub-checkbox">
            <input type="checkbox" checked={isToddlerFriendly} onChange={(event) => setIsToddlerFriendly(event.target.checked)} />
            <span>Toddler friendly</span>
          </label>
        </div>
        {busy ? <p className="hub-muted-copy">Loading places…</p> : null}
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        <div className="hub-list">
          {visiblePlaces.map((place) => (
            <article key={place._id} className="hub-list-card">
              <div className="hub-list-head">
                <div>
                  <h3>{place.name || 'Unnamed place'}</h3>
                  <p>{[place.city, place.state].filter(Boolean).join(', ') || 'Location unavailable'}</p>
                </div>
                <span className="hub-pill hub-pill--neutral">{place.playgroundType || 'General'}</span>
              </div>
              <p>{place.description || 'No description yet.'}</p>
              <div className="hub-actions-inline">
                <Link href={`/playground/${encodeURIComponent(place._id)}`} className="btn btn-teal">View details</Link>
                <button
                  type="button"
                  className="btn btn-outline hub-btn-dark"
                  disabled={favBusyId === place._id}
                  onClick={() => toggleFavorite(place._id)}
                >
                  {favoriteIds.includes(place._id) ? 'Remove favorite' : 'Save favorite'}
                </button>
              </div>
            </article>
          ))}
          {!busy && visiblePlaces.length === 0 && !error ? <p className="hub-empty">No places returned yet.</p> : null}
        </div>
        {!busy && hasMore && !usingSearchEndpoint ? (
          <div className="hub-actions-inline" style={{ marginTop: '12px' }}>
            <button type="button" className="btn btn-outline hub-btn-dark" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </section>
    </ConsumerPageFrame>
  );
}
