'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { getAuthToken, webFetch } from '../components/webAuthClient';

export default function PlacePage() {
  return (
    <Suspense fallback={
      <ConsumerPageFrame
        title="Place details"
        subtitle="Detail view parity scaffold for ratings, amenities, photos, and reports."
      >
        <section className="hub-card">
          <p className="hub-muted-copy">Loading place view…</p>
        </section>
      </ConsumerPageFrame>
    }
    >
      <PlacePageInner />
    </Suspense>
  );
}

function PlacePageInner() {
  const searchParams = useSearchParams();
  const placeId = useMemo(() => searchParams.get('id') || '', [searchParams]);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [place, setPlace] = useState(null);
  const [reports, setReports] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [rating, setRating] = useState('5');
  const [crowdLevel, setCrowdLevel] = useState('Quiet');
  const [issueType, setIssueType] = useState('other');
  const [issueDescription, setIssueDescription] = useState('');

  useEffect(() => {
    async function load() {
      if (!placeId) return;
      setBusy(true);
      setError('');
      setMessage('');
      try {
        const hasToken = Boolean(getAuthToken());
        const [placeResponse, reportsResponse, favoritesResponse, listsResponse] = await Promise.all([
          webFetch(`/api/playgrounds/${encodeURIComponent(placeId)}`),
          webFetch(`/api/reports/${encodeURIComponent(placeId)}`).catch(() => ({ data: null })),
          hasToken ? webFetch('/api/favorites/me/ids').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
          hasToken ? webFetch('/api/lists').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        ]);
        setPlace(placeResponse.data || null);
        setReports(reportsResponse.data || null);
        setIsFavorite((favoritesResponse.data || []).includes(placeId));
        setLists(listsResponse.data || []);
      } catch (err) {
        setError(err.message || 'Could not load place details.');
      } finally {
        setBusy(false);
      }
    }
    load();
  }, [placeId]);

  async function requireAuthAction(task) {
    if (!getAuthToken()) {
      setError('Sign in from Account to use this action.');
      return;
    }
    setActionBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (err) {
      setError(err.message || 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  }

  async function toggleFavorite() {
    await requireAuthAction(async () => {
      await webFetch('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ placeId }),
      });
      setIsFavorite((current) => !current);
      setMessage(isFavorite ? 'Removed from favorites.' : 'Saved to favorites.');
    });
  }

  async function submitRating(event) {
    event.preventDefault();
    await requireAuthAction(async () => {
      await webFetch(`/api/playgrounds/${encodeURIComponent(placeId)}/rate`, {
        method: 'POST',
        body: JSON.stringify({ rating: Number(rating) }),
      });
      setMessage('Rating saved.');
    });
  }

  async function quickVerify() {
    await requireAuthAction(async () => {
      const location = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation is not supported in this browser.'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Location permission is required for quick verify.')));
      });
      await webFetch(`/api/playgrounds/${encodeURIComponent(placeId)}/quick-verify`, {
        method: 'POST',
        body: JSON.stringify({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          rating: Number(rating),
        }),
      });
      setMessage('Verification submitted.');
    });
  }

  async function submitCrowd(event) {
    event.preventDefault();
    await requireAuthAction(async () => {
      await webFetch('/api/reports/crowd', {
        method: 'POST',
        body: JSON.stringify({ placeId, crowdLevel }),
      });
      setMessage('Crowd report submitted.');
      const refreshed = await webFetch(`/api/reports/${encodeURIComponent(placeId)}`).catch(() => ({ data: null }));
      setReports(refreshed.data || null);
    });
  }

  async function submitIssue(event) {
    event.preventDefault();
    await requireAuthAction(async () => {
      await webFetch('/api/reports/issue', {
        method: 'POST',
        body: JSON.stringify({
          placeId,
          issueType,
          description: issueDescription,
        }),
      });
      setIssueDescription('');
      setMessage('Issue report submitted.');
      const refreshed = await webFetch(`/api/reports/${encodeURIComponent(placeId)}`).catch(() => ({ data: null }));
      setReports(refreshed.data || null);
    });
  }

  async function addToList() {
    if (!selectedListId) {
      setError('Select a list first.');
      return;
    }
    await requireAuthAction(async () => {
      await webFetch(`/api/lists/${encodeURIComponent(selectedListId)}/add`, {
        method: 'PUT',
        body: JSON.stringify({ placeId }),
      });
      setMessage('Added to list.');
    });
  }

  return (
    <ConsumerPageFrame
      title="Place details"
      subtitle="Detail view parity scaffold for ratings, amenities, photos, and reports."
    >
      <section className="hub-card">
        {!placeId ? <p className="hub-muted-copy">Select a place from Discover to view details.</p> : null}
        {busy ? <p className="hub-muted-copy">Loading details…</p> : null}
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
        {place ? (
          <>
            <div className="hub-summary">
              <div><strong>Name:</strong> {place.name || 'Unknown'}</div>
              <div><strong>Address:</strong> {place.address || 'Not provided'}</div>
              <div><strong>City/State:</strong> {[place.city, place.state].filter(Boolean).join(', ') || 'Not provided'}</div>
              <div><strong>Type:</strong> {place.playgroundType || 'Not provided'}</div>
              <div><strong>Description:</strong> {place.description || 'Not provided'}</div>
            </div>

            <div className="hub-actions-inline" style={{ marginTop: '12px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline hub-btn-dark" disabled={actionBusy} onClick={toggleFavorite}>
                {isFavorite ? 'Remove favorite' : 'Save favorite'}
              </button>
              <button type="button" className="btn btn-outline hub-btn-dark" disabled={actionBusy} onClick={quickVerify}>
                Quick verify with location
              </button>
              <a className="btn btn-outline hub-btn-dark" href={`/edit-place?id=${encodeURIComponent(placeId)}`}>
                Suggest edits
              </a>
            </div>

            <form className="hub-actions-inline" style={{ marginTop: '12px', flexWrap: 'wrap' }} onSubmit={submitRating}>
              <label>
                <span className="hub-muted-copy">Rating </span>
                <select value={rating} onChange={(event) => setRating(event.target.value)}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
              <button type="submit" className="btn btn-teal" disabled={actionBusy}>Submit rating</button>
            </form>

            <div className="hub-actions-inline" style={{ marginTop: '12px', flexWrap: 'wrap' }}>
              <select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}>
                <option value="">Add to list…</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
              <button type="button" className="btn btn-outline hub-btn-dark" disabled={actionBusy} onClick={addToList}>
                Add to selected list
              </button>
            </div>

            <form className="hub-actions-inline" style={{ marginTop: '12px', flexWrap: 'wrap' }} onSubmit={submitCrowd}>
              <select value={crowdLevel} onChange={(event) => setCrowdLevel(event.target.value)}>
                <option value="Quiet">Quiet</option>
                <option value="Busy">Busy</option>
                <option value="Packed">Packed</option>
              </select>
              <button type="submit" className="btn btn-outline hub-btn-dark" disabled={actionBusy}>Submit crowd report</button>
            </form>

            <form className="hub-form-grid" style={{ marginTop: '12px' }} onSubmit={submitIssue}>
              <label className="hub-field">
                <span>Issue type</span>
                <select value={issueType} onChange={(event) => setIssueType(event.target.value)}>
                  <option value="broken_equipment">Broken equipment</option>
                  <option value="unsafe_area">Unsafe area</option>
                  <option value="traffic_risk">Traffic risk</option>
                  <option value="aggressive_dogs">Aggressive dogs</option>
                  <option value="incorrect_info">Incorrect info</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="hub-field hub-field--full">
                <span>Issue details</span>
                <textarea
                  rows={3}
                  value={issueDescription}
                  onChange={(event) => setIssueDescription(event.target.value)}
                  placeholder="Describe the issue"
                />
              </label>
              <div className="hub-actions-inline hub-field--full">
                <button type="submit" className="btn btn-outline hub-btn-dark" disabled={actionBusy}>Submit issue report</button>
              </div>
            </form>

            {reports ? (
              <div className="hub-detail-card" style={{ marginTop: '12px' }}>
                <h3>Community reports</h3>
                <p><strong>Latest crowd:</strong> {reports.latestCrowd?.crowdLevel || 'None yet'}</p>
                <p><strong>Open issues:</strong> {(reports.activeIssues || []).length}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </ConsumerPageFrame>
  );
}
