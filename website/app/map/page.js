'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';
import {
  DEFAULT_SEARCH_RADIUS_MILES,
  haversineMiles,
  readCachedLatLng,
  requestBrowserLatLng,
  sortPlacesByDistance,
} from '../lib/geoSearch';

const PlacesMap = dynamic(() => import('../components/PlacesMap'), { ssr: false });

export default function MapPage() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [places, setPlaces] = useState([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [coords, setCoords] = useState(() => (typeof window === 'undefined' ? null : readCachedLatLng()));
  const [locationPhase, setLocationPhase] = useState(() => {
    const c = typeof window === 'undefined' ? null : readCachedLatLng();
    return c && Number.isFinite(c.lat) && Number.isFinite(c.lng) ? 'ok' : 'idle';
  });
  const mapBlockRef = useRef(null);

  useEffect(() => {
    const cached = readCachedLatLng();
    if (cached) {
      setCoords(cached);
      setLocationPhase('ok');
    }
  }, []);

  const loadPlaces = useCallback(async () => {
    if (locationPhase === 'locating') return;
    setBusy(true);
    setError('');
    try {
      const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
      if (!hasCoords) {
        setPlaces([]);
        return;
      }
      const params = new URLSearchParams({
        lat: String(coords.lat),
        lng: String(coords.lng),
        radius: String(DEFAULT_SEARCH_RADIUS_MILES),
      });
      const response = await webFetch(`/api/playgrounds/search?${params.toString()}`);
      setPlaces(response.data || []);
    } catch (err) {
      setError(err.message || 'Could not load map data.');
    } finally {
      setBusy(false);
    }
  }, [locationPhase, coords]);

  useEffect(() => {
    loadPlaces();
  }, [loadPlaces]);

  async function requestUserLocation() {
    setBusy(true);
    setLocationPhase('locating');
    const fresh = await requestBrowserLatLng();
    if (fresh) {
      setCoords(fresh);
      setLocationPhase('ok');
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

  const mappableBase = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return places
      .filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
      .filter((p) => (typeFilter === 'all' ? true : String(p.playgroundType || '').toLowerCase() === typeFilter))
      .filter((p) => (cityFilter === 'all' ? true : String(p.city || '') === cityFilter))
      .filter((p) => {
        if (!normalizedQuery) return true;
        return [p.name, p.city, p.state, p.address, p.playgroundType]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      });
  }, [places, query, typeFilter, cityFilter]);

  const mappable = useMemo(() => {
    if (hasCoords) {
      return sortPlacesByDistance(mappableBase, coords.lat, coords.lng).slice(0, 150);
    }
    return mappableBase.slice(0, 150);
  }, [mappableBase, hasCoords, coords]);

  const cityOptions = useMemo(() => {
    const cities = [...new Set(places.map((p) => p.city).filter(Boolean))];
    return cities.sort((a, b) => String(a).localeCompare(String(b)));
  }, [places]);

  const typeOptions = useMemo(() => {
    const types = [...new Set(places.map((p) => p.playgroundType).filter(Boolean))];
    return types.map((value) => String(value).toLowerCase()).sort((a, b) => a.localeCompare(b));
  }, [places]);

  const selectedPlace = useMemo(
    () => mappable.find((place) => String(place._id) === String(selectedPlaceId)) || null,
    [mappable, selectedPlaceId],
  );

  useEffect(() => {
    if (selectedPlaceId && !mappable.some((p) => String(p._id) === String(selectedPlaceId))) {
      setSelectedPlaceId('');
    }
  }, [mappable, selectedPlaceId]);

  const selectFromList = (id) => {
    setSelectedPlaceId(String(id));
    requestAnimationFrame(() => {
      mapBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const mapHint = (() => {
    if (locationPhase === 'locating') return 'Requesting your location from the browser…';
    if (hasCoords) {
      return `Places within ~${DEFAULT_SEARCH_RADIUS_MILES} mi (same proximity query as the app). Sorted by distance.`;
    }
    return 'The map stays empty until we have a point near you—no random pins in other states. Tap “Find near me.”';
  })();

  return (
    <ConsumerPageFrame
      title="Map"
      subtitle="OpenStreetMap with pins from the app directory. Find near me when you are ready—cached location from a past visit also works."
      heroVariant="tall"
    >
      <section className="hub-card">
        <div className="hub-card-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2>Places on the map</h2>
            <p className="hub-muted-copy">{mapHint}</p>
          </div>
          {(locationPhase === 'idle' || locationPhase === 'denied') ? (
            <button type="button" className="btn btn-teal" onClick={requestUserLocation}>
              Find near me
            </button>
          ) : null}
          {locationPhase === 'ok' && hasCoords ? (
            <button type="button" className="btn btn-outline hub-btn-dark" onClick={requestUserLocation}>
              Update location
            </button>
          ) : null}
        </div>
        <div className="hub-actions-inline" style={{ margin: '12px 0', flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, city, address…"
          />
          <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
            <option value="all">All cities</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All types</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <p className="hub-muted-copy">
          {busy
            ? 'Loading map points…'
            : hasCoords
              ? `${mappable.length} places match current filters.`
              : 'No pins until we have your location.'}
        </p>
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        {!busy && hasCoords && mappable.length > 0 ? (
          <div ref={mapBlockRef} style={{ marginBottom: 16 }}>
            <PlacesMap
              places={mappable}
              height={440}
              selectedId={selectedPlaceId}
              onMarkerClick={(id) => setSelectedPlaceId(String(id))}
            />
            <p className="hub-muted-copy" style={{ marginTop: 10, marginBottom: 0 }}>
              Click a row below or a map pin to sync the table and the map. Selected rows are highlighted.
            </p>
          </div>
        ) : null}
        {!busy && !hasCoords ? (
          <div className="hub-empty hub-empty--location" style={{ marginBottom: 16 }}>
            <p>
              <strong>Map is empty on purpose</strong> — we need a location to show nearby places. Tap{' '}
              <strong>Find near me</strong> in the header, or use a saved point from a past visit on this browser.
            </p>
            {(locationPhase === 'idle' || locationPhase === 'denied') ? (
              <div className="hub-actions-inline" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-teal" onClick={requestUserLocation}>
                  Find near me
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {hasCoords ? (
        <div className="hub-table-wrap">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>City</th>
                <th>Type</th>
                <th>Mi</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mappable.map((place) => {
                const isRowSelected = String(selectedPlaceId) === String(place._id);
                return (
                  <tr
                    key={place._id}
                    className={isRowSelected ? 'is-selected' : undefined}
                    onClick={() => selectFromList(place._id)}
                  >
                    <td>{place.name || place._id}</td>
                    <td>{place.city || '—'}</td>
                    <td>{place.playgroundType || '—'}</td>
                    <td>
                      {Number.isFinite(Number(place.latitude)) && Number.isFinite(Number(place.longitude))
                        ? haversineMiles(
                          coords.lat,
                          coords.lng,
                          Number(place.latitude),
                          Number(place.longitude),
                        ).toFixed(1)
                        : '—'}
                    </td>
                    <td>{place.latitude}</td>
                    <td>{place.longitude}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="hub-actions-inline">
                        <Link
                          href={`/playground/${encodeURIComponent(place._id)}/`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : null}
        {selectedPlace && hasCoords ? (
          <div className="hub-detail-card" style={{ marginTop: '12px' }}>
            <h3>{selectedPlace.name || 'Selected place'}</h3>
            <p>{[selectedPlace.address, selectedPlace.city, selectedPlace.state].filter(Boolean).join(', ')}</p>
            <div style={{ width: '100%', height: '320px', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)' }}>
              <iframe
                title="Selected place map preview"
                width="100%"
                height="320"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(`${selectedPlace.latitude},${selectedPlace.longitude}`)}&z=15&output=embed`}
              />
            </div>
            <div className="hub-actions-inline" style={{ marginTop: '10px' }}>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${selectedPlace.latitude},${selectedPlace.longitude}`)}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-teal"
              >
                Open directions
              </a>
              <Link href={`/playground/${encodeURIComponent(selectedPlace._id)}`} className="btn btn-outline hub-btn-dark">
                Open place details
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </ConsumerPageFrame>
  );
}
