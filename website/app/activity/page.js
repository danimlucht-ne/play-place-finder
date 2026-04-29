'use client';

import { useEffect, useState } from 'react';
import AuthGate from '../components/AuthGate';
import ConsumerPageFrame from '../components/ConsumerPageFrame';
import { webFetch } from '../components/webAuthClient';

export default function ActivityPage() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [notifications, setNotifications] = useState([]);

  async function load() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const [submissionsRes, notificationsRes] = await Promise.all([
        webFetch('/api/users/me/submissions?limit=50'),
        webFetch('/api/users/me/notifications'),
      ]);
      setSubmissions(submissionsRes.data || []);
      setNotifications(notificationsRes.data || []);
    } catch (err) {
      setError(err.message || 'Could not load activity.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markNotificationsRead() {
    setError('');
    setMessage('');
    try {
      await webFetch('/api/users/me/notifications/mark-read', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotifications([]);
      setMessage('Notifications marked as read.');
    } catch (err) {
      setError(err.message || 'Could not mark notifications read.');
    }
  }

  return (
    <ConsumerPageFrame
      title="My activity"
      subtitle="Track your submissions and account notifications across app and web."
      heroVariant="tall"
    >
      <AuthGate>
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Notifications</h2>
              <p>Unread account and moderation updates.</p>
            </div>
            <div className="hub-actions-inline">
              <button type="button" className="btn btn-outline hub-btn-dark" onClick={markNotificationsRead}>
                Mark all read
              </button>
              <button type="button" className="btn btn-teal" onClick={load}>Refresh</button>
            </div>
          </div>
          {busy ? <p className="hub-muted-copy">Loading activity…</p> : null}
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
          <div className="hub-list">
            {notifications.map((item) => (
              <article key={item._id} className="hub-list-card">
                <h3>{item.title || item.type || 'Notification'}</h3>
                <p>{item.message || 'No message provided.'}</p>
              </article>
            ))}
            {!busy && notifications.length === 0 ? <p className="hub-empty">No unread notifications.</p> : null}
          </div>
        </section>

        <section className="hub-card">
          <h2>My submissions</h2>
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
            {!busy && submissions.length === 0 ? <p className="hub-empty">No submissions yet.</p> : null}
          </div>
        </section>
      </AuthGate>
    </ConsumerPageFrame>
  );
}
