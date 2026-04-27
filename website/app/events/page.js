'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

export default function EventsPage() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState([]);
  const [cityId, setCityId] = useState('');
  const [placement, setPlacement] = useState('inline_listing');

  async function load() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!cityId.trim()) {
        setEvents([]);
        setMessage('Enter a city id to load active event ads.');
        return;
      }
      const response = await webFetch(
        `/api/ads/all?city_id=${encodeURIComponent(cityId.trim())}&placement=${encodeURIComponent(placement)}`,
      );
      const rows = (response.data || []).filter((item) => item.isEvent === true);
      setEvents(rows);
      if (rows.length === 0) {
        setMessage('No active event ads for this city/placement right now.');
      }
    } catch (err) {
      setError(err.message || 'Could not load events.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setBusy(false);
  }, []);

  return (
    <ConsumerPageFrame
      title="Events"
      subtitle="Event Spotlight feed parity for dated business events promoted in app and calendar views."
    >
      <section className="hub-card">
        <h2>Upcoming promoted events</h2>
        <div className="hub-actions-inline" style={{ margin: '12px 0', flexWrap: 'wrap' }}>
          <input
            value={cityId}
            onChange={(event) => setCityId(event.target.value)}
            placeholder="City ID (required by ads API)"
          />
          <select value={placement} onChange={(event) => setPlacement(event.target.value)}>
            <option value="inline_listing">Calendar / Inline</option>
            <option value="featured_home">Calendar / Prime</option>
          </select>
          <button type="button" className="btn btn-teal" onClick={load} disabled={busy}>
            {busy ? 'Loading…' : 'Load events'}
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
                  <Link className="btn btn-teal" href={`/playground/${encodeURIComponent(eventRow.placeId)}`}>
                    Open related place
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
          {!busy && events.length === 0 && !error ? <p className="hub-empty">No event campaigns available.</p> : null}
        </div>
      </section>
    </ConsumerPageFrame>
  );
}
