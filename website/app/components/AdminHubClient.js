'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  clearSharedAuthSession,
  formatDateOnly,
  formatDateTime,
  formatMoney,
  getDefaultApiBase,
  hubFetch,
  loadHubSettings,
  readJwtClaims,
  saveHubSettings,
  saveSharedAuthSession,
  statusTone,
} from './hubClientUtils';
import HubAuthPanel from './HubAuthPanel';

export default function AdminHubClient() {
  const [apiBase, setApiBase] = useState(getDefaultApiBase());
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [moderationItems, setModerationItems] = useState([]);
  const [supportTickets, setSupportTickets] = useState([]);
  const [playgroundDebug, setPlaygroundDebug] = useState(null);
  const [playgroundList, setPlaygroundList] = useState([]);
  const [playgroundCursor, setPlaygroundCursor] = useState(null);
  const [playgroundFilter, setPlaygroundFilter] = useState('');
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [submissionDetail, setSubmissionDetail] = useState(null);
  const [selectedModeration, setSelectedModeration] = useState(null);
  const [moderationDetail, setModerationDetail] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [paymentDetail, setPaymentDetail] = useState(null);
  const [selectedPlayground, setSelectedPlayground] = useState(null);
  const [playgroundDetail, setPlaygroundDetail] = useState(null);
  const [mergeAudit, setMergeAudit] = useState(null);
  const [reviewReason, setReviewReason] = useState('');
  const [statusFilter, setStatusFilter] = useState('manual_review');
  const [moderationStatus, setModerationStatus] = useState('PENDING');
  const [supportStatus, setSupportStatus] = useState('NEEDS_ADMIN_REVIEW');
  const [campaignAction, setCampaignAction] = useState({ reason: '', days: '7', amountInCents: '0' });

  useEffect(() => {
    const settings = loadHubSettings('admin');
    setApiBase(settings.apiBase);
    setToken(settings.token);
  }, []);

  const claims = useMemo(() => readJwtClaims(token), [token]);
  const isAdmin = claims?.admin === true;

  function confirmAction(message) {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.confirm(message);
  }

  async function runTask(task, successMessage) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await task();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function persistSettings() {
    saveHubSettings('admin', { apiBase, token });
    setMessage('Saved admin hub connection settings on this browser.');
    setError('');
  }

  function handleAuthenticated(nextToken) {
    setToken(nextToken);
    saveSharedAuthSession(apiBase, nextToken);
    setMessage('Signed in and saved admin session in this browser.');
    setError('');
  }

  function handleSignedOut() {
    setToken('');
    clearSharedAuthSession();
    setSubmissions([]);
    setCampaigns([]);
    setModerationItems([]);
    setSupportTickets([]);
    setPlaygroundDebug(null);
    setPlaygroundList([]);
    setPlaygroundCursor(null);
    setPlaygroundFilter('');
    setSelectedSubmission(null);
    setSubmissionDetail(null);
    setSelectedModeration(null);
    setModerationDetail(null);
    setSelectedCampaign(null);
    setPaymentDetail(null);
    setSelectedPlayground(null);
    setPlaygroundDetail(null);
    setMergeAudit(null);
    setMessage('Signed out of the admin hub.');
    setError('');
  }

  async function fetchAndSetAdminData() {
    const [submissionRes, campaignRes, moderationRes, supportRes, debugRes] = await Promise.all([
      hubFetch(apiBase, token, `/admin/ads/submissions?status=${encodeURIComponent(statusFilter)}`),
      hubFetch(apiBase, token, '/admin/ads/campaigns'),
      hubFetch(apiBase, token, `/admin/moderation?status=${encodeURIComponent(moderationStatus)}`),
      hubFetch(apiBase, token, `/admin/support-tickets?status=${encodeURIComponent(supportStatus)}`),
      hubFetch(apiBase, token, '/admin/debug-playgrounds'),
    ]);
    setSubmissions(submissionRes.data || []);
    setCampaigns(campaignRes.data || []);
    setModerationItems(moderationRes.data || []);
    setSupportTickets(supportRes.data || []);
    setPlaygroundDebug(debugRes || null);
  }

  /** Toolbar refresh. Post-action code should call `fetchAndSetAdminData` inside the same `runTask` to avoid clobbering success toasts. */
  async function refreshAdmin({ notify = true } = {}) {
    setBusy(true);
    if (notify) {
      setMessage('');
    }
    setError('');
    try {
      await fetchAndSetAdminData();
      if (notify) {
        setMessage('Admin hub refreshed.');
      }
    } catch (err) {
      setError(err.message || 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadPlaygroundsPageData(useNextCursor) {
    const cursorPart = useNextCursor && playgroundCursor ? `&cursor=${encodeURIComponent(playgroundCursor)}` : '';
    const response = await hubFetch(apiBase, token, `/api/playgrounds?limit=100${cursorPart}`);
    const data = response.data || [];
    if (useNextCursor) {
      setPlaygroundList((current) => [...current, ...data]);
    } else {
      setPlaygroundList(data);
    }
    setPlaygroundCursor(response.nextCursor || null);
  }

  async function loadPlaygroundsBatch(useNextCursor = false) {
    await runTask(async () => {
      await loadPlaygroundsPageData(useNextCursor);
      return true;
    }, useNextCursor ? 'Loaded more playgrounds.' : 'Loaded playgrounds.');
  }

  async function loadPlaygroundDetail(playgroundId) {
    await runTask(async () => {
      const [detailRes, auditRes] = await Promise.all([
        hubFetch(apiBase, token, `/api/playgrounds/${playgroundId}`),
        hubFetch(apiBase, token, `/admin/playgrounds/${playgroundId}/merge-audit`).catch(() => ({ data: null })),
      ]);
      setSelectedPlayground(playgroundId);
      setPlaygroundDetail(detailRes.data || null);
      setMergeAudit(auditRes.data || null);
      return true;
    });
  }

  async function archivePlayground(playgroundId) {
    if (
      !confirmAction(
        'Archive (soft-delete) this playground? The listing will be hidden. This is difficult to reverse from this hub — continue?',
      )
    ) {
      return;
    }
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/playgrounds/${playgroundId}`, {
        method: 'DELETE',
      });
      if (selectedPlayground === playgroundId) {
        setPlaygroundDetail((current) => (current ? { ...current, archivedAt: new Date().toISOString() } : current));
      }
      await loadPlaygroundsPageData(false);
      await fetchAndSetAdminData();
      return true;
    }, 'Playground archived.');
  }

  const filteredPlaygrounds = playgroundList.filter((playground) => {
    if (!playgroundFilter.trim()) return true;
    const query = playgroundFilter.trim().toLowerCase();
    return [playground.name, playground.city, playground.state, playground.playgroundType]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  async function loadSubmission(id) {
    await runTask(async () => {
      const response = await hubFetch(apiBase, token, `/admin/ads/submissions/${id}`);
      setSelectedSubmission(id);
      setSubmissionDetail(response.data || null);
      return true;
    });
  }

  async function reviewSubmission(id, decision) {
    if (decision === 'reject' && !reviewReason.trim()) {
      setError('Add a reason in “Shared reason / note” before rejecting.');
      return;
    }
    if (decision === 'reject' && !confirmAction('Reject this ad submission? The advertiser will see the reason you provided.')) {
      return;
    }
    if (decision === 'approve' && !confirmAction('Approve this ad submission?')) {
      return;
    }
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/ads/submissions/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: reviewReason }),
      });
      await fetchAndSetAdminData();
      const response = await hubFetch(apiBase, token, `/admin/ads/submissions/${id}`);
      setSelectedSubmission(id);
      setSubmissionDetail(response.data || null);
      return true;
    }, `Submission ${decision}d.`);
  }

  async function requestRevision(id) {
    if (!reviewReason.trim()) {
      setError('Add a message in “Shared reason / note” before requesting a revision.');
      return;
    }
    if (!confirmAction('Send a revision request to the advertiser?')) {
      return;
    }
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/ads/submissions/${id}/request-revision`, {
        method: 'POST',
        body: JSON.stringify({ message: reviewReason }),
      });
      await fetchAndSetAdminData();
      const response = await hubFetch(apiBase, token, `/admin/ads/submissions/${id}`);
      setSelectedSubmission(id);
      setSubmissionDetail(response.data || null);
      return true;
    }, 'Revision requested.');
  }

  function confirmAdminSetStatus(status) {
    if (status === 'approved' || status === 'cancelled') {
      return confirmAction(
        `Force this submission to ${status}? This bypasses normal review — only continue if you are sure.`,
      );
    }
    if (status === 'manual_review') {
      return confirmAction('Set this submission back to manual review?');
    }
    return true;
  }

  async function adminSetStatus(id, status) {
    if (!confirmAdminSetStatus(status)) {
      return;
    }
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/ads/submissions/${id}/admin-set-status`, {
        method: 'POST',
        body: JSON.stringify({ status, note: reviewReason }),
      });
      await fetchAndSetAdminData();
      const response = await hubFetch(apiBase, token, `/admin/ads/submissions/${id}`);
      setSelectedSubmission(id);
      setSubmissionDetail(response.data || null);
      return true;
    }, `Submission moved to ${status}.`);
  }

  async function loadPayment(campaignId) {
    await runTask(async () => {
      const response = await hubFetch(apiBase, token, `/admin/ads/campaigns/${campaignId}/payment`);
      setSelectedCampaign(campaignId);
      setPaymentDetail(response.data || null);
      return true;
    });
  }

  async function loadModeration(id) {
    await runTask(async () => {
      const response = await hubFetch(apiBase, token, `/admin/moderation/${id}`);
      setSelectedModeration(id);
      setModerationDetail(response.data || null);
      return true;
    });
  }

  function confirmModerationAction(action) {
    if (action === 'approve') {
      return confirmAction('Approve this moderation item and publish the change?');
    }
    if (action === 'reject') {
      return confirmAction('Reject this moderation item? The submitter can see a decision reason if you add one above.');
    }
    return confirmAction('Retry this moderation item (e.g. after fixing upstream data)?');
  }

  async function moderatePlayground(id, action) {
    if (action === 'reject' && !reviewReason.trim()) {
      setError('Add a decision in “Shared reason / note” before rejecting.');
      return;
    }
    if (!confirmModerationAction(action)) {
      return;
    }
    const path = action === 'approve'
      ? `/admin/moderation/${id}/approve`
      : action === 'retry'
        ? `/admin/moderation/${id}/retry`
        : `/admin/moderation/${id}/reject`;
    const body = action === 'reject' ? { decisionReason: reviewReason } : {};
    await runTask(async () => {
      await hubFetch(apiBase, token, path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await fetchAndSetAdminData();
      if (selectedModeration === id) {
        const response = await hubFetch(apiBase, token, `/admin/moderation/${id}`);
        setSelectedModeration(id);
        setModerationDetail(response.data || null);
      }
      return true;
    }, `Moderation item ${action}d.`);
  }

  async function resolveSupportTicket(id, action) {
    if (action === 'reject' && !reviewReason.trim()) {
      setError('Add a resolution reason in “Shared reason / note” before rejecting a ticket.');
      return;
    }
    const sure =
      action === 'resolve'
        ? confirmAction('Mark this support ticket as resolved?')
        : confirmAction('Reject this support ticket?');
    if (!sure) {
      return;
    }
    const path = action === 'resolve' ? `/admin/support-tickets/${id}/resolve` : `/admin/support-tickets/${id}/reject`;
    await runTask(async () => {
      await hubFetch(apiBase, token, path, {
        method: 'POST',
        body: JSON.stringify({ resolutionReason: reviewReason }),
      });
      await fetchAndSetAdminData();
      return true;
    }, `Support ticket ${action}d.`);
  }

  function campaignActionConfirmMessage(action) {
    switch (action) {
      case 'pause':
        return 'Pause this campaign? It will stop showing until you unpause.';
      case 'unpause':
        return 'Unpause this campaign?';
      case 'cancel':
        return 'Cancel this campaign? This usually cannot be undone from this hub.';
      case 'refund':
        return 'Process a refund for the selected campaign? This affects payments.';
      case 'extend':
        return 'Extend the selected campaign end date?';
      default:
        return 'Run this campaign action?';
    }
  }

  async function runCampaignAction(campaignId, action) {
    if (!confirmAction(campaignActionConfirmMessage(action))) {
      return;
    }
    const body =
      action === 'extend'
        ? { days: Number(campaignAction.days), reason: campaignAction.reason }
        : action === 'refund'
          ? { type: Number(campaignAction.amountInCents) > 0 ? 'partial' : 'full', amountInCents: Number(campaignAction.amountInCents), reason: campaignAction.reason }
          : { reason: campaignAction.reason };

    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/ads/campaigns/${campaignId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await fetchAndSetAdminData();
      if (selectedCampaign === campaignId) {
        const response = await hubFetch(apiBase, token, `/admin/ads/campaigns/${campaignId}/payment`);
        setSelectedCampaign(campaignId);
        setPaymentDetail(response.data || null);
      }
      return true;
    }, `Campaign ${action} action completed.`);
  }

  return (
    <div className="container hub-page">
      <section className="hub-hero">
        <div>
          <p className="hub-eyebrow">Admin tools</p>
          <h1>Advertising Admin Hub</h1>
          <p className="hub-lead">
            Review ad submissions, request revisions, and manage campaign lifecycle actions from the web.
          </p>
        </div>
        <div className="hub-tip-card">
          <h2>Expected access</h2>
          <ul>
            <li>Admin Firebase ID token with the admin claim</li>
            <li>API base URL for the Play Spotter server</li>
            <li>Optional local mock token only when the server explicitly allows it</li>
          </ul>
        </div>
      </section>

      <section className="hub-card">
        <div className="hub-card-head">
          <div>
            <h2>Connection</h2>
            <p>Use the same API base as the mobile app backend.</p>
          </div>
          <div className="hub-actions-inline">
            <button type="button" className="btn btn-outline hub-btn-dark" onClick={persistSettings}>Save settings</button>
            <button type="button" className="btn btn-teal" disabled={busy} onClick={() => void refreshAdmin()}>Refresh admin hub</button>
          </div>
        </div>
        <div className="hub-form-grid">
          <label className="hub-field">
            <span>API base URL</span>
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="http://localhost:3001" />
          </label>
          <label className="hub-field">
            <span>Admin bearer token</span>
            <textarea value={token} rows={4} onChange={(event) => setToken(event.target.value)} placeholder="Paste an admin Firebase ID token" />
          </label>
          <label className="hub-field">
            <span>Submission status filter</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="manual_review">manual_review</option>
              <option value="approved">approved</option>
              <option value="approved_pending_charge">approved_pending_charge</option>
              <option value="revision_requested">revision_requested</option>
              <option value="rejected">rejected</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
          <label className="hub-field hub-field--full">
            <span>Shared reason / note</span>
            <textarea value={reviewReason} rows={3} onChange={(event) => setReviewReason(event.target.value)} placeholder="Used for reviews, revision requests, and admin status notes." />
          </label>
        </div>
        {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
      </section>

      <HubAuthPanel
        apiBase={apiBase}
        token={token}
        onAuthenticated={handleAuthenticated}
        onSignedOut={handleSignedOut}
        audience="admin"
      />

      {!token ? (
        <section className="hub-card">
          <h2>Admin access required</h2>
          <p className="hub-muted-copy">
            Sign in with an admin account to open the review queue and campaign controls.
          </p>
        </section>
      ) : null}

      {token && !isAdmin ? (
        <section className="hub-card">
          <h2>Admin claim required</h2>
          <p className="hub-muted-copy">
            This page is only for Play Spotter admins. Your current account is signed in, but it does not carry the Firebase <code>admin</code> claim required for the admin APIs.
          </p>
        </section>
      ) : null}

      {!isAdmin ? null : (
        <>

      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Submission queue</h2>
              <p>Review items that need manual approval or correction.</p>
            </div>
          </div>
          <div className="hub-list">
            {submissions.length === 0 ? <p className="hub-empty">No submissions loaded yet.</p> : submissions.map((submission) => (
              <article key={submission._id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{submission.reviewDisplayName || submission._id}</h3>
                    <p>{formatDateTime(submission.createdAt)} · {submission._id}</p>
                  </div>
                  <span className={`hub-pill hub-pill--${statusTone(submission.status)}`}>{submission.status || 'unknown'}</span>
                </div>
                <p className="hub-muted-copy">
                  Flags: {(submission.reviewFlags || []).length}
                </p>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadSubmission(submission._id)}>Load detail</button>
                  <button type="button" className="btn btn-teal" onClick={() => reviewSubmission(submission._id, 'approve')}>Approve</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => reviewSubmission(submission._id, 'reject')}>Reject</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => requestRevision(submission._id)}>Request revision</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Submission detail</h2>
              <p>View advertiser, creative, and flag details before acting.</p>
            </div>
          </div>
          {!submissionDetail ? (
            <p className="hub-empty">Choose a submission to inspect it here.</p>
          ) : (
            <div className="hub-detail-card">
              <p><strong>Submission:</strong> {selectedSubmission}</p>
              <p><strong>Status:</strong> <span className={`hub-pill hub-pill--${statusTone(submissionDetail.status)}`}>{submissionDetail.status || 'unknown'}</span></p>
              <p><strong>Advertiser:</strong> {submissionDetail.advertiser?.businessName || 'Unknown advertiser'}</p>
              <p><strong>Email:</strong> {submissionDetail.advertiser?.contactEmail || 'No email'}</p>
              <p><strong>Headline:</strong> {submissionDetail.creative?.headline || 'No creative yet'}</p>
              <p><strong>Body:</strong> {submissionDetail.creative?.body || 'No creative body yet'}</p>
              <p><strong>Package:</strong> {submissionDetail.package?.type || 'Not selected'}</p>
              <p><strong>Total price:</strong> {formatMoney(submissionDetail.totalPriceInCents || 0)}</p>
              <div className="hub-table-wrap">
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th>Flag type</th>
                      <th>Description</th>
                      <th>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(submissionDetail.reviewFlags || []).map((flag, index) => (
                      <tr key={`${flag.flagType}-${index}`}>
                        <td>{flag.flagType || 'Unknown'}</td>
                        <td>{flag.description || 'No description'}</td>
                        <td>{flag.severity || 'Unknown'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="hub-actions-inline">
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => adminSetStatus(selectedSubmission, 'manual_review')}>Set manual review</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => adminSetStatus(selectedSubmission, 'approved')}>Force approved</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => adminSetStatus(selectedSubmission, 'cancelled')}>Force cancelled</button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="hub-card">
        <div className="hub-card-head">
          <div>
            <h2>Campaign operations</h2>
            <p>Use admin lifecycle controls for scheduled and active campaigns.</p>
          </div>
        </div>
        <div className="hub-list">
          {campaigns.length === 0 ? <p className="hub-empty">No campaigns loaded yet.</p> : campaigns.map((campaign) => (
            <article key={campaign._id} className="hub-list-card">
              <div className="hub-list-head">
                <div>
                  <h3>{campaign.businessName || campaign.headline || campaign._id}</h3>
                  <p>{formatDateOnly(campaign.startDate)} to {formatDateOnly(campaign.endDate)} · {campaign.cityId || 'No city id'}</p>
                </div>
                <span className={`hub-pill hub-pill--${statusTone(campaign.status)}`}>{campaign.status || 'unknown'}</span>
              </div>
              <div className="hub-stats-grid">
                <div><strong>{campaign.impressions || 0}</strong><span>Impressions</span></div>
                <div><strong>{campaign.clicks || 0}</strong><span>Clicks</span></div>
                <div><strong>{formatMoney(campaign.totalPriceInCents || 0)}</strong><span>Stored total</span></div>
              </div>
              <div className="hub-actions-inline">
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadPayment(campaign._id)}>Payment</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => runCampaignAction(campaign._id, 'pause')}>Pause</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => runCampaignAction(campaign._id, 'unpause')}>Unpause</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => runCampaignAction(campaign._id, 'cancel')}>Cancel</button>
              </div>
            </article>
          ))}
        </div>
        <div className="hub-form-grid hub-form-grid--tight">
          <label className="hub-field">
            <span>Campaign reason</span>
            <input value={campaignAction.reason} onChange={(event) => setCampaignAction((current) => ({ ...current, reason: event.target.value }))} />
          </label>
          <label className="hub-field">
            <span>Extend by days</span>
            <input type="number" min="1" max="90" value={campaignAction.days} onChange={(event) => setCampaignAction((current) => ({ ...current, days: event.target.value }))} />
          </label>
          <label className="hub-field">
            <span>Partial refund amount in cents</span>
            <input type="number" min="0" value={campaignAction.amountInCents} onChange={(event) => setCampaignAction((current) => ({ ...current, amountInCents: event.target.value }))} />
          </label>
          <label className="hub-field">
            <span>Selected campaign id</span>
            <input value={selectedCampaign || ''} onChange={(event) => setSelectedCampaign(event.target.value || null)} placeholder="Set from Payment button or paste an id" />
          </label>
          <div className="hub-actions-inline hub-field--full">
            <button type="button" className="btn btn-outline hub-btn-dark" disabled={!selectedCampaign} onClick={() => runCampaignAction(selectedCampaign, 'extend')}>Extend selected</button>
            <button type="button" className="btn btn-outline hub-btn-dark" disabled={!selectedCampaign} onClick={() => runCampaignAction(selectedCampaign, 'refund')}>Refund selected</button>
          </div>
        </div>
        {paymentDetail ? (
          <div className="hub-detail-card">
            <h3>Selected payment detail</h3>
            <p><strong>Status:</strong> {paymentDetail.status || 'Unknown'}</p>
            <p><strong>Amount:</strong> {formatMoney(paymentDetail.amountInCents || 0)}</p>
            <p><strong>Processor:</strong> {paymentDetail.processor || 'Stripe'}</p>
            <p><strong>Created:</strong> {formatDateTime(paymentDetail.createdAt)}</p>
          </div>
        ) : null}
      </section>

      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Playground moderation queue</h2>
              <p>Review pending playground, edit, and photo moderation items.</p>
            </div>
          </div>
          <div className="hub-form-grid hub-form-grid--tight">
            <label className="hub-field">
              <span>Moderation status</span>
              <select value={moderationStatus} onChange={(event) => setModerationStatus(event.target.value)}>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </label>
          </div>
          <div className="hub-list">
            {moderationItems.length === 0 ? <p className="hub-empty">No moderation items loaded.</p> : moderationItems.map((item) => (
              <article key={item.id || item._id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{item.playgroundName || item.name || item.id || 'Moderation item'}</h3>
                    <p>{item.submissionType || item.type || 'Unknown type'} · {item.status || 'Unknown status'}</p>
                  </div>
                  <span className={`hub-pill hub-pill--${statusTone(item.status)}`}>{item.status || 'unknown'}</span>
                </div>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadModeration(item.id || item._id)}>View detail</button>
                  <button type="button" className="btn btn-teal" onClick={() => moderatePlayground(item.id || item._id, 'approve')}>Approve</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => moderatePlayground(item.id || item._id, 'reject')}>Reject</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => moderatePlayground(item.id || item._id, 'retry')}>Retry</button>
                </div>
              </article>
            ))}
          </div>
          {moderationDetail ? (
            <div className="hub-detail-card">
              <h3>Selected moderation detail</h3>
              <p><strong>Item:</strong> {selectedModeration}</p>
              <p><strong>Submission type:</strong> {moderationDetail.submissionType || 'Unknown'}</p>
              <p><strong>Status:</strong> {moderationDetail.status || 'Unknown'}</p>
              <p><strong>Playground:</strong> {moderationDetail.playgroundName || moderationDetail.name || 'Unknown playground'}</p>
              <p><strong>Submitted:</strong> {formatDateTime(moderationDetail.createdAt)}</p>
              {moderationDetail.decisionReason ? <p><strong>Decision reason:</strong> {moderationDetail.decisionReason}</p> : null}
              {moderationDetail.proposedChanges ? (
                <div className="hub-json-block">
                  <pre>{JSON.stringify(moderationDetail.proposedChanges, null, 2)}</pre>
                </div>
              ) : null}
              {moderationDetail.proposedNewPlayground ? (
                <div className="hub-json-block">
                  <pre>{JSON.stringify(moderationDetail.proposedNewPlayground, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Support and playground sample</h2>
              <p>See incoming tickets and a real sample of playground records from the server.</p>
            </div>
          </div>
          <div className="hub-form-grid hub-form-grid--tight">
            <label className="hub-field">
              <span>Support status</span>
              <select value={supportStatus} onChange={(event) => setSupportStatus(event.target.value)}>
                <option value="NEEDS_ADMIN_REVIEW">NEEDS_ADMIN_REVIEW</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </label>
          </div>
          <div className="hub-list">
            {supportTickets.length === 0 ? <p className="hub-empty">No support tickets loaded.</p> : supportTickets.map((ticket) => (
              <article key={ticket.id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{ticket.ticketType || 'Support ticket'}</h3>
                    <p>{ticket.category || 'No category'} · {formatDateTime(ticket.createdAt)}</p>
                    {ticket.actorUserId ? (
                      <p className="hub-muted-copy">Reporter (signed-in): <code>{ticket.actorUserId}</code></p>
                    ) : null}
                  </div>
                  <span className={`hub-pill hub-pill--${statusTone(ticket.status)}`}>{ticket.status || 'unknown'}</span>
                </div>
                <p className="hub-muted-copy">{ticket.message || 'No message'}</p>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-teal" onClick={() => resolveSupportTicket(ticket.id, 'resolve')}>Resolve</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => resolveSupportTicket(ticket.id, 'reject')}>Reject</button>
                </div>
              </article>
            ))}
          </div>
          {playgroundDebug ? (
            <div className="hub-detail-card">
              <h3>Playground sample from server</h3>
              <div className="hub-stats-grid">
                <div><strong>{playgroundDebug.total || 0}</strong><span>Total playgrounds</span></div>
                <div><strong>{playgroundDebug.withCost || 0}</strong><span>With cost</span></div>
                <div><strong>{playgroundDebug.missingCost || 0}</strong><span>Missing cost</span></div>
              </div>
              <div className="hub-table-wrap">
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Cost</th>
                      <th>Google Place</th>
                      <th>Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(playgroundDebug.sample || []).map((playground) => (
                      <tr key={String(playground._id)}>
                        <td>{playground.name || 'Unknown'}</td>
                        <td>{playground.costRange || 'Unknown'}</td>
                        <td>{playground.googlePlaceId || 'None'}</td>
                        <td>{playground.lastVerifiedSource || 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Browse playgrounds</h2>
              <p>Load active playgrounds, filter by name or city, then open full detail and merge audit.</p>
            </div>
            <div className="hub-actions-inline">
              <button type="button" className="btn btn-teal" onClick={() => loadPlaygroundsBatch(false)}>Load playgrounds</button>
              <button type="button" className="btn btn-outline hub-btn-dark" disabled={!playgroundCursor} onClick={() => loadPlaygroundsBatch(true)}>Load more</button>
            </div>
          </div>
          <div className="hub-form-grid hub-form-grid--tight">
            <label className="hub-field hub-field--full">
              <span>Filter loaded playgrounds</span>
              <input value={playgroundFilter} onChange={(event) => setPlaygroundFilter(event.target.value)} placeholder="Name, city, state, or type" />
            </label>
          </div>
          <div className="hub-list">
            {filteredPlaygrounds.length === 0 ? <p className="hub-empty">No playgrounds loaded yet.</p> : filteredPlaygrounds.map((playground) => (
              <article key={String(playground.id || playground._id)} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{playground.name || 'Unnamed playground'}</h3>
                    <p>{[playground.city, playground.state].filter(Boolean).join(', ') || 'Location unknown'} · {playground.playgroundType || 'Type unknown'}</p>
                  </div>
                  <span className={`hub-pill hub-pill--${playground.archivedAt ? 'bad' : 'good'}`}>{playground.archivedAt ? 'archived' : 'active'}</span>
                </div>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadPlaygroundDetail(String(playground.id || playground._id))}>Open detail</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => archivePlayground(String(playground.id || playground._id))}>Archive</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Selected playground</h2>
              <p>Inspect a real playground record and the merge audit attached to it.</p>
            </div>
          </div>
          {!playgroundDetail ? (
            <p className="hub-empty">Choose a playground from the browser list to inspect it here.</p>
          ) : (
            <div className="hub-detail-card">
              <p><strong>Name:</strong> {playgroundDetail.name || 'Unknown'}</p>
              <p><strong>ID:</strong> {selectedPlayground}</p>
              <p><strong>Location:</strong> {[playgroundDetail.city, playgroundDetail.state].filter(Boolean).join(', ') || 'Unknown'}</p>
              <p><strong>Type:</strong> {playgroundDetail.playgroundType || 'Unknown'}</p>
              <p><strong>Cost:</strong> {playgroundDetail.costRange || 'Unknown'}</p>
              <p><strong>Verification source:</strong> {playgroundDetail.lastVerifiedSource || 'None'}</p>
              <div className="hub-actions-inline">
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => archivePlayground(selectedPlayground)}>Archive playground</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadPlaygroundDetail(selectedPlayground)}>Refresh detail</button>
              </div>
              <div className="hub-json-block">
                <pre>{JSON.stringify(playgroundDetail, null, 2)}</pre>
              </div>
              {mergeAudit ? (
                <div className="hub-json-block">
                  <pre>{JSON.stringify(mergeAudit, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
        </>
      )}
    </div>
  );
}
