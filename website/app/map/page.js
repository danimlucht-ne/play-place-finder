'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

export default function MapPage() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [places, setPlaces] = useState([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [selectedPlaceId, setSelectedPlaceId] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const response = await webFetch('/api/playgrounds?limit=100');
        setPlaces(response.data || []);
      } catch (err) {
        setError(err.message || 'Could not load map data.');
      } finally {
        setBusy(false);
      }
    }
    load();
  }, []);

  const mappable = useMemo(() => {
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

  return (
    <ConsumerPageFrame
      title="Map"
      subtitle="Map parity scaffold using shared place coordinates. Google Maps rendering can layer on this data source."
    >
      <section className="hub-card">
        <h2>Coordinate feed</h2>
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
          {busy ? 'Loading map points…' : `${mappable.length} places match current filters.`}
        </p>
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        <div className="hub-table-wrap">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>City</th>
                <th>Type</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mappable.slice(0, 150).map((place) => (
                <tr key={place._id}>
                  <td>{place.name || place._id}</td>
                  <td>{place.city || '—'}</td>
                  <td>{place.playgroundType || '—'}</td>
                  <td>{place.latitude}</td>
                  <td>{place.longitude}</td>
                  <td>
                    <div className="hub-actions-inline">
                      <button type="button" onClick={() => setSelectedPlaceId(place._id)}>Preview</button>
                      <Link href={`/place?id=${encodeURIComponent(place._id)}`}>Details</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedPlace ? (
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
              <Link href={`/place?id=${encodeURIComponent(selectedPlace._id)}`} className="btn btn-outline hub-btn-dark">
                Open place details
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </ConsumerPageFrame>
  );
}
