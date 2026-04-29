'use client';

import { useEffect, useState } from 'react';
import AuthGate from '../components/AuthGate';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

export default function MySubmissionsPage() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [submissions, setSubmissions] = useState([]);

  async function loadSubmissions() {
    setBusy(true);
    setError('');
    try {
      const response = await webFetch('/api/users/me/submissions?limit=100');
      setSubmissions(response.data || []);
    } catch (err) {
      setError(err.message || 'Could not load submissions.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadSubmissions();
  }, []);

  return (
    <ConsumerPageFrame
      title="My submissions"
      subtitle="Track status for places and edits you have submitted."
      heroVariant="tall"
    >
      <AuthGate>
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Submission history</h2>
              <p>Review pending, approved, and rejected submissions.</p>
            </div>
            <div className="hub-actions-inline">
              <button type="button" className="btn btn-teal" onClick={loadSubmissions}>
                Refresh
              </button>
            </div>
          </div>
          {busy ? <p className="hub-muted-copy">Loading submissions…</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
          <div className="hub-list">
            {submissions.map((item) => (
              <article key={item._id} className="hub-list-card">
                <div className="hub-list-head">
                  <h3>{item.submissionType || 'Submission'}</h3>
                  <span className="hub-pill hub-pill--neutral">{item.status || 'pending'}</span>
                </div>
                <p>{item.playgroundName || item.reason || item.message || 'No details provided.'}</p>
              </article>
            ))}
            {!busy && submissions.length === 0 && !error ? <p className="hub-empty">No submissions yet.</p> : null}
          </div>
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
