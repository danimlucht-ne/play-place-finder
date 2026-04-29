'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';
import { readCachedLatLng, requestBrowserLatLng } from '../lib/geoSearch';

export default function EventsPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState([]);
  const [cityId, setCityId] = useState('');
  const [placement, setPlacement] = useState('inline_listing');
  const [regionLabel, setRegionLabel] = useState('');
  /** idle | locating | ok — mirrors Discover: no automatic GPS on load */
  const [locationPhase, setLocationPhase] = useState('idle');
  const [autoResolved, setAutoResolved] = useState(false);

  const loadEvents = useCallback(async (id, place) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!id.trim()) {
        setEvents([]);
        setMessage('Enter a region id, or use your saved location to resolve one automatically.');
        return;
      }
      const response = await webFetch(
        `/api/ads/all?city_id=${encodeURIComponent(id.trim())}&placement=${encodeURIComponent(place)}`,
      );
      const rows = (response.data || []).filter((item) => item.isEvent === true);
      setEvents(rows);
      if (rows.length === 0) {
        setMessage('No active event ads for this region/placement right now.');
      }
    } catch (err) {
      setError(err.message || 'Could not load events.');
    } finally {
      setBusy(false);
    }
  }, []);

  const tryResolveRegionFromCoords = useCallback(
    async (lat, lng) => {
      const response = await webFetch(
        `/api/playgrounds/search?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=50`,
      );
      const rows = response.data || [];
      const keyed = rows.find((p) => p.regionKey && String(p.regionKey).trim());
      if (!keyed) return null;
      return {
        regionKey: String(keyed.regionKey).trim(),
        label: [keyed.city, keyed.state].filter(Boolean).join(', '),
      };
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = readCachedLatLng();
      if (!cached) {
        setLocationPhase('idle');
        return;
      }
      setLocationPhase('locating');
      try {
        const resolved = await tryResolveRegionFromCoords(cached.lat, cached.lng);
        if (cancelled) return;
        if (resolved) {
          setCityId(resolved.regionKey);
          setRegionLabel(resolved.label);
          setAutoResolved(true);
          setLocationPhase('ok');
          await loadEvents(resolved.regionKey, 'inline_listing');
        } else {
          setLocationPhase('ok');
          setMessage(
            'Saved location found but no listing returned a campaign region. Enter a region id manually, or try Discover first.',
          );
        }
      } catch {
        if (!cancelled) setLocationPhase('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tryResolveRegionFromCoords, loadEvents]);

  async function requestUserLocation() {
    setLocationPhase('locating');
    setMessage('');
    const fresh = await requestBrowserLatLng();
    const c = fresh || readCachedLatLng();
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
      setLocationPhase('idle');
      setError('Location unavailable. You can still paste a region id from your advertiser tools or admin.');
      return;
    }
    try {
      const resolved = await tryResolveRegionFromCoords(c.lat, c.lng);
      if (resolved) {
        setCityId(resolved.regionKey);
        setRegionLabel(resolved.label);
        setAutoResolved(true);
        setLocationPhase('ok');
        await loadEvents(resolved.regionKey, placement);
      } else {
        setLocationPhase('ok');
        setMessage('Could not resolve a campaign region from nearby listings. Enter city id manually.');
      }
    } catch (err) {
      setLocationPhase('idle');
      setError(err.message || 'Could not resolve region.');
    }
  }

  function onSubmitLoad() {
    setAutoResolved(false);
    loadEvents(cityId, placement);
  }

  return (
    <ConsumerPageFrame
      title="Events"
      subtitle="Promoted event campaigns—same city/region key as the app’s calendar (resolved from your location when possible)."
      heroVariant="tall"
    >
      <section className="hub-card">
        <h2>Upcoming promoted events</h2>
        {regionLabel ? (
          <p className="hub-muted-copy">
            {autoResolved ? 'Region from your location: ' : 'Region: '}
            <strong>{regionLabel}</strong>
            {cityId ? (
              <>
                {' '}
                <span className="hub-pill hub-pill--neutral">{cityId}</span>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="hub-actions-inline" style={{ margin: '12px 0', flexWrap: 'wrap' }}>
          <input
            value={cityId}
            onChange={(event) => setCityId(event.target.value)}
            placeholder="Region / city id (ads API)"
            aria-label="Region or city id for ads"
          />
          <select value={placement} onChange={(event) => setPlacement(event.target.value)}>
            <option value="inline_listing">Calendar / Inline</option>
            <option value="featured_home">Calendar / Prime</option>
          </select>
          <button type="button" className="btn btn-teal" onClick={onSubmitLoad} disabled={busy}>
            {busy ? 'Loading…' : 'Load events'}
          </button>
          <button type="button" className="btn btn-outline hub-btn-dark" onClick={requestUserLocation} disabled={busy || locationPhase === 'locating'}>
            {locationPhase === 'locating' ? 'Locating…' : 'Use my location'}
          </button>
        </div>
        {busy ? <p className="hub-muted-copy">Loading events…</p> : null}
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
        <div className="hub-list">
          {events.map((eventRow) => (
            <article key={eventRow._id} className="hub-list-card">
              <div className="hub-list-head">
                <div>
                  <h3>{eventRow.headline || eventRow.businessName || 'Event'}</h3>
                  <p>{eventRow.body || 'No description provided.'}</p>
                </div>
                <span className="hub-pill hub-pill--warn">Event</span>
              </div>
              <div className="hub-summary">
                <div><strong>Business:</strong> {eventRow.businessName || 'Unknown'}</div>
                <div><strong>Placement:</strong> {eventRow.placement || placement}</div>
                <div><strong>Date:</strong> {eventRow.eventDate || 'Not specified'}</div>
              </div>
              <div className="hub-actions-inline">
                {eventRow.ctaUrl ? (
                  <a className="btn btn-outline hub-btn-dark" href={eventRow.ctaUrl} target="_blank" rel="noreferrer">
                    Open event link
                  </a>
                ) : null}
                {eventRow.placeId ? (
                  <Link className="btn btn-teal" href={`/playground/${encodeURIComponent(eventRow.placeId)}/`}>
                    Open related place
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
          {!busy && events.length === 0 && !error && !message ? (
            <p className="hub-empty">No event campaigns loaded yet. Use your location or enter a region id.</p>
          ) : null}
        </div>
      </section>
    </ConsumerPageFrame>
  );
}
