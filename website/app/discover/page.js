'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { WEB_AUTH_EVENT, getAuthToken, webFetch } from '../components/webAuthClient';
import {
  DEFAULT_SEARCH_RADIUS_MILES,
  WIDE_TEXT_SEARCH_RADIUS_MILES,
  haversineMiles,
  readCachedLatLng,
  requestBrowserLatLng,
  sortPlacesByDistance,
} from '../lib/geoSearch';

function matchesNameQuery(place, q) {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return [place.name, place.city, place.state, place.address]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

/** For paginated /recent fallback only (GET /playgrounds/search already applies your filters for the main list). */
function matchesPlaygroundFilters(place, playgroundType, hasBathrooms, isToddlerFriendly) {
  if (playgroundType !== 'all' && String(place.playgroundType || '') !== playgroundType) {
    return false;
  }
  if (hasBathrooms && place.hasBathrooms !== true) {
    return false;
  }
  if (isToddlerFriendly && place.isToddlerFriendly !== true) {
    return false;
  }
  return true;
}

async function loadFavoritesInto(setFavoriteIds) {
  if (!getAuthToken()) {
    setFavoriteIds([]);
    return;
  }
  const favoritesResponse = await webFetch('/api/favorites/me/ids').catch(() => ({ data: [] }));
  setFavoriteIds(favoritesResponse.data || []);
}

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
  const [debouncedNameQuery, setDebouncedNameQuery] = useState('');
  const [playgroundType, setPlaygroundType] = useState('all');
  const [hasBathrooms, setHasBathrooms] = useState(false);
  const [isToddlerFriendly, setIsToddlerFriendly] = useState(false);
  const [sortBy, setSortBy] = useState(() =>
    typeof window !== 'undefined' && readCachedLatLng() ? 'distance' : 'newest',
  );
  const [coords, setCoords] = useState(null);
  /** idle | locating | ok | denied — ok includes cached coordinates; no auto GPS prompt on load */
  const [locationPhase, setLocationPhase] = useState('idle');
  const [usingSearchEndpoint, setUsingSearchEndpoint] = useState(false);
  /** false | hybrid (POST search/hybrid) | recent (global newest list) */
  const [proximityFallback, setProximityFallback] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_SEARCH_RADIUS_MILES);
  /** Bumps when auth changes so empty-state “sign in” copy updates */
  const [authTick, setAuthTick] = useState(0);

  const playgroundTypes = [
    'all',
    'Playground',
    'Indoor Play Center',
    'Park',
    'Splash Pad',
    'Library',
  ];

  useEffect(() => {
    const t = setTimeout(() => setDebouncedNameQuery(nameQuery), 400);
    return () => clearTimeout(t);
  }, [nameQuery]);

  useEffect(() => {
    const cached = readCachedLatLng();
    if (cached) {
      setCoords(cached);
      setLocationPhase('ok');
    }
  }, []);

  const applySort = useCallback(
    (rows) => {
      const copy = [...rows];
      const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
      if (sortBy === 'distance' && hasCoords) {
        return sortPlacesByDistance(copy, coords.lat, coords.lng);
      }
      if (sortBy === 'name') {
        return copy.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      }
      if (sortBy === 'rating') {
        return copy.sort((a, b) => Number(b.averageRating || 0) - Number(a.averageRating || 0));
      }
      return copy;
    },
    [sortBy, coords],
  );

  const loadDiscover = useCallback(async () => {
    if (locationPhase === 'locating') return;
    setBusy(true);
    setError('');
    setProximityFallback(false);
    try {
      const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
      const textActive = debouncedNameQuery.trim().length > 0;
      const radius = textActive ? WIDE_TEXT_SEARCH_RADIUS_MILES : radiusMiles;
      const needsFilterSearch =
        playgroundType !== 'all' || hasBathrooms || isToddlerFriendly;

      if (hasCoords || needsFilterSearch) {
        setUsingSearchEndpoint(true);
        const params = new URLSearchParams();
        if (hasCoords) {
          params.set('lat', String(coords.lat));
          params.set('lng', String(coords.lng));
          params.set('radius', String(radius));
        }
        if (playgroundType !== 'all') params.set('playgroundType', playgroundType);
        if (hasBathrooms) params.set('hasBathrooms', 'true');
        if (isToddlerFriendly) params.set('isToddlerFriendly', 'true');
        const response = await webFetch(`/api/playgrounds/search?${params.toString()}`);
        let rows = response.data || [];
        rows = rows.filter((p) => matchesNameQuery(p, debouncedNameQuery));
        if (hasCoords && rows.length === 0) {
          const canHybrid = Boolean(getAuthToken());
          if (canHybrid) {
            let hybridPlaces = [];
            try {
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), 120000);
              const hybridRes = await webFetch('/api/search/hybrid', {
                method: 'POST',
                body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
                signal: ctrl.signal,
              }).finally(() => clearTimeout(timer));
              const rawPlaces = hybridRes?.places ?? hybridRes?.data?.places;
              hybridPlaces = Array.isArray(rawPlaces) ? rawPlaces : [];
            } catch {
              hybridPlaces = [];
            }
            if (hybridPlaces.length > 0) {
              rows = hybridPlaces.filter((p) => matchesNameQuery(p, debouncedNameQuery));
              setProximityFallback('hybrid');
            } else {
              const fb = await webFetch('/api/playgrounds?limit=40');
              rows = (fb.data || [])
                .filter((p) => matchesNameQuery(p, debouncedNameQuery))
                .filter((p) => matchesPlaygroundFilters(p, playgroundType, hasBathrooms, isToddlerFriendly));
              setProximityFallback('recent');
            }
          } else {
            const fb = await webFetch('/api/playgrounds?limit=40');
            rows = (fb.data || [])
              .filter((p) => matchesNameQuery(p, debouncedNameQuery))
              .filter((p) => matchesPlaygroundFilters(p, playgroundType, hasBathrooms, isToddlerFriendly));
            setProximityFallback('recent');
          }
        }
        setPlaces(applySort(rows));
        setCursor('');
        setHasMore(false);
      } else {
        setUsingSearchEndpoint(false);
        const response = await webFetch('/api/playgrounds?limit=40');
        let rows = response.data || [];
        rows = rows.filter((p) => matchesNameQuery(p, debouncedNameQuery));
        setPlaces(applySort(rows));
        setCursor(response.nextCursor || '');
        setHasMore(Boolean(response.nextCursor));
      }
      await loadFavoritesInto(setFavoriteIds);
    } catch (err) {
      setError(err.message || 'Could not load places.');
    } finally {
      setBusy(false);
    }
  }, [
    locationPhase,
    coords,
    playgroundType,
    hasBathrooms,
    isToddlerFriendly,
    debouncedNameQuery,
    radiusMiles,
    applySort,
    authTick,
  ]);

  useEffect(() => {
    loadDiscover();
  }, [loadDiscover]);

  useEffect(() => {
    function onAuthOrStorage() {
      loadFavoritesInto(setFavoriteIds);
      setAuthTick((n) => n + 1);
    }
    window.addEventListener(WEB_AUTH_EVENT, onAuthOrStorage);
    window.addEventListener('storage', onAuthOrStorage);
    return () => {
      window.removeEventListener(WEB_AUTH_EVENT, onAuthOrStorage);
      window.removeEventListener('storage', onAuthOrStorage);
    };
  }, []);

  useEffect(() => {
    const ok = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
    if (!ok && sortBy === 'distance') {
      setSortBy('newest');
    }
  }, [coords, sortBy]);

  async function loadMore() {
    if (!cursor || usingSearchEndpoint) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await webFetch(`/api/playgrounds?limit=40&cursor=${encodeURIComponent(cursor)}`);
      const nextRows = response.data || [];
      setPlaces((current) => applySort([...current, ...nextRows]));
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

  async function requestUserLocation() {
    setLocationPhase('locating');
    const fresh = await requestBrowserLatLng();
    if (fresh) {
      setCoords(fresh);
      setLocationPhase('ok');
      setSortBy((s) => (s === 'newest' ? 'distance' : s));
    } else {
      const c = readCachedLatLng();
      if (c) {
        setCoords(c);
        setLocationPhase('ok');
      } else {
        setCoords(null);
        setLocationPhase('denied');
      }
    }
  }

  const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
  const isLoggedIn = useMemo(() => Boolean(getAuthToken()), [authTick]);
  const filtersOrTextActive =
    playgroundType !== 'all'
    || hasBathrooms
    || isToddlerFriendly
    || debouncedNameQuery.trim().length > 0;
  const locationHint = (() => {
    if (locationPhase === 'locating') return 'Requesting location…';
    if (hasCoords) {
      const mi = debouncedNameQuery.trim() ? WIDE_TEXT_SEARCH_RADIUS_MILES : radiusMiles;
      return `Places within ~${mi} mi (same proximity search as the app).`;
    }
    return 'Location not shared — showing the latest listings. Tap “Use my location” to search nearby.';
  })();

  return (
    <ConsumerPageFrame
      title="Discover play places"
      subtitle="Same proximity search as the app. Location runs only when you tap “Use my location” or use a saved pin from an earlier visit."
      heroVariant="tall"
    >
      <section className="hub-card">
        <div className="hub-card-head">
          <div>
            <h2>{hasCoords ? 'Near you' : 'All sites'}</h2>
            <p>{locationHint}</p>
          </div>
          <div className="hub-actions-inline">
            {(locationPhase === 'idle' || locationPhase === 'denied') ? (
              <button type="button" className="btn btn-teal" onClick={requestUserLocation}>
                Use my location
              </button>
            ) : null}
            {locationPhase === 'ok' && hasCoords ? (
              <button type="button" className="btn btn-outline hub-btn-dark" onClick={requestUserLocation}>
                Refresh location
              </button>
            ) : null}
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
          <select
            value={radiusMiles}
            onChange={(event) => setRadiusMiles(Number(event.target.value))}
            title="Search radius when location is on"
            disabled={!hasCoords}
          >
            <option value={25}>25 mi</option>
            <option value={50}>50 mi</option>
            <option value={100}>100 mi</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="distance" disabled={!hasCoords}>Distance</option>
            <option value="newest">Newest (list order)</option>
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
        {proximityFallback === 'hybrid' && hasCoords ? (
          <p className="hub-feedback hub-feedback--warn">
            Your radius search was empty — loaded hybrid results for this area (signed-in only; name/city text applies,
            not the type/amenity toggles).
          </p>
        ) : null}
        {proximityFallback === 'recent' && hasCoords ? (
          <p className="hub-feedback hub-feedback--warn">
            Nothing in range — {isLoggedIn ? 'hybrid also returned no rows — ' : 'sign in to use hybrid; '}
            showing the newest listings that match your text + filters.
          </p>
        ) : null}
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        <div className="hub-list">
          {places.map((place) => {
            let distanceSuffix = '';
            if (
              hasCoords
              && Number.isFinite(Number(place.latitude))
              && Number.isFinite(Number(place.longitude))
            ) {
              const mi = haversineMiles(
                coords.lat,
                coords.lng,
                Number(place.latitude),
                Number(place.longitude),
              );
              if (Number.isFinite(mi) && mi < 1e6) {
                distanceSuffix = ` · ${mi.toFixed(1)} mi`;
              }
            }
            return (
              <article key={place._id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{place.name || 'Unnamed place'}</h3>
                    <p>
                      {[place.city, place.state].filter(Boolean).join(', ') || 'Location unavailable'}
                      {distanceSuffix}
                    </p>
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
            );
          })}
          {!busy && places.length === 0 && !error ? (
            hasCoords ? (
              filtersOrTextActive ? (
                <p className="hub-empty">
                  Nothing matched your filters or search. Try clearing them, widening your radius, or changing the name
                  search.
                </p>
              ) : isLoggedIn ? (
                <p className="hub-empty">
                  Nothing showed up near this location. Try a wider radius or check back soon—coverage is growing.
                </p>
              ) : (
                <div className="hub-empty hub-empty--account">
                  <p>
                    <strong>There are no locations near you in the public list yet.</strong>
                    {' '}
                    Create a free account—signed-in requests use the same discovery and hybrid loading as the Play
                    Spotter app, so we can load places for your area.
                  </p>
                  <div className="hub-actions-inline" style={{ marginTop: 14 }}>
                    <Link href="/account/" className="btn btn-teal">
                      Create an account
                    </Link>
                    <Link href="/account/" className="btn btn-outline hub-btn-dark">
                      Sign in
                    </Link>
                  </div>
                </div>
              )
            ) : (
              <p className="hub-empty">No places returned yet. Set your location or try again in a moment.</p>
            )
          ) : null}
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
