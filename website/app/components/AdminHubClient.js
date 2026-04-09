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
  const overviewCards = [
    { label: 'Ad reviews waiting', value: submissions.length },
    { label: 'Campaigns loaded', value: campaigns.length },
    { label: 'Playground items waiting', value: moderationItems.length },
    { label: 'Support tickets waiting', value: supportTickets.length },
  ];

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

  async function refreshAdmin() {
    await runTask(async () => {
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
      return true;
    }, 'Admin hub refreshed.');
  }

  async function loadPlaygroundsBatch(useNextCursor = false) {
    await runTask(async () => {
      const cursorPart = useNextCursor && playgroundCursor ? `&cursor=${encodeURIComponent(playgroundCursor)}` : '';
      const response = await hubFetch(apiBase, token, `/api/playgrounds?limit=100${cursorPart}`);
      const data = response.data || [];
      setPlaygroundList((current) => (useNextCursor ? [...current, ...data] : data));
      setPlaygroundCursor(response.nextCursor || null);
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
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/playgrounds/${playgroundId}`, {
        method: 'DELETE',
      });
      if (selectedPlayground === playgroundId) {
        setPlaygroundDetail((current) => current ? { ...current, archivedAt: new Date().toISOString() } : current);
      }
      await loadPlaygroundsBatch(false);
      await refreshAdmin();
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
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/ads/submissions/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: reviewReason }),
      });
      await refreshAdmin();
      await loadSubmission(id);
      return true;
    }, `Submission ${decision}d.`);
  }

  async function requestRevision(id) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/ads/submissions/${id}/request-revision`, {
        method: 'POST',
        body: JSON.stringify({ message: reviewReason }),
      });
      await refreshAdmin();
      await loadSubmission(id);
      return true;
    }, 'Revision requested.');
  }

  async function adminSetStatus(id, status) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/admin/ads/submissions/${id}/admin-set-status`, {
        method: 'POST',
        body: JSON.stringify({ status, note: reviewReason }),
      });
      await refreshAdmin();
      await loadSubmission(id);
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

  async function moderatePlayground(id, action) {
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
      await refreshAdmin();
      if (selectedModeration === id) {
        await loadModeration(id);
      }
      return true;
    }, `Moderation item ${action}d.`);
  }

  async function resolveSupportTicket(id, action) {
    const path = action === 'resolve' ? `/admin/support-tickets/${id}/resolve` : `/admin/support-tickets/${id}/reject`;
    await runTask(async () => {
      await hubFetch(apiBase, token, path, {
        method: 'POST',
        body: JSON.stringify({ resolutionReason: reviewReason }),
      });
      await refreshAdmin();
      return true;
    }, `Support ticket ${action}d.`);
  }

  async function runCampaignAction(campaignId, action) {
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
      await refreshAdmin();
      if (selectedCampaign === campaignId) {
        await loadPayment(campaignId);
      }
      return true;
    }, `Campaign ${action} action completed.`);
  }

  return (
    <div className="container hub-page hub-page--admin">
      <section className="hub-hero">
        <div>
          <p className="hub-eyebrow">Admin workspace</p>
          <h1>Admin Control Center</h1>
          <p className="hub-lead">
            Review advertiser requests, manage live campaigns, handle support needs, and look into playground moderation from one cleaner workspace.
          </p>
        </div>
        <div className="hub-tip-card">
          <h2>What lives here</h2>
          <ul>
            <li>Ad reviews and campaign controls</li>
            <li>Playground moderation and support follow-up</li>
            <li>Signed-in admin access only</li>
          </ul>
        </div>
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
            Sign in with your admin account to open the review queues and control tools.
          </p>
        </section>
      ) : null}

      {token && !isAdmin ? (
        <section className="hub-card">
          <h2>This account does not have admin access</h2>
          <p className="hub-muted-copy">
            You are signed in, but this account is not marked as a PlayPlace Finder admin. Use an approved admin account to continue.
          </p>
        </section>
      ) : null}

      {!isAdmin ? null : (
        <div className="hub-admin-shell">
      <section className="hub-card hub-card--admin-overview">
        <div className="hub-card-head">
          <div>
            <h2>Today&apos;s overview</h2>
            <p>Refresh this page whenever you want the latest queue counts and campaign activity.</p>
          </div>
          <div className="hub-actions-inline">
            <button type="button" className="btn btn-teal" disabled={busy} onClick={refreshAdmin}>Refresh workspace</button>
          </div>
        </div>
        <div className="hub-stats-grid hub-stats-grid--four">
          {overviewCards.map((card) => (
            <div key={card.label}>
              <strong>{card.value}</strong>
              <span>{card.label}</span>
            </div>
          ))}
        </div>
        <div className="hub-form-grid hub-form-grid--tight">
          <label className="hub-field">
            <span>Ad review status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="manual_review">Needs manual review</option>
              <option value="approved">Approved</option>
              <option value="approved_pending_charge">Approved and waiting for payment</option>
              <option value="revision_requested">Revision requested</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="hub-field hub-field--full">
            <span>Shared note for your next action</span>
            <textarea value={reviewReason} rows={3} onChange={(event) => setReviewReason(event.target.value)} placeholder="Use this for review notes, revision requests, rejection reasons, or support follow-up." />
          </label>
        </div>
        {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
        {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
      </section>


      <section className="hub-section-block">
        <div className="hub-section-heading">
          <p className="hub-section-kicker">Advertising</p>
          <h2>Review incoming advertiser work</h2>
        </div>
      <div className="hub-grid hub-grid--balanced">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Advertising review queue</h2>
              <p>Review new advertiser submissions and decide what needs approval, revision, or rejection.</p>
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
                  Review flags: {(submission.reviewFlags || []).length}
                </p>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadSubmission(submission._id)}>Open details</button>
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
              <h2>Selected advertising request</h2>
              <p>See the business, message, and review notes before you take action.</p>
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
              <p><strong>Ad title:</strong> {submissionDetail.creative?.headline || 'No creative yet'}</p>
              <p><strong>Ad copy:</strong> {submissionDetail.creative?.body || 'No creative body yet'}</p>
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
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => adminSetStatus(selectedSubmission, 'manual_review')}>Move back to review</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => adminSetStatus(selectedSubmission, 'approved')}>Mark approved</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => adminSetStatus(selectedSubmission, 'cancelled')}>Mark cancelled</button>
              </div>
            </div>
          )}
        </section>
      </div>
      </section>

      <section className="hub-section-block">
        <div className="hub-section-heading">
          <p className="hub-section-kicker">Campaigns</p>
          <h2>Manage live and scheduled campaigns</h2>
        </div>
      <section className="hub-card hub-card--feature">
        <div className="hub-card-head">
          <div>
            <h2>Campaign management</h2>
            <p>Review what is currently running and take action on live or scheduled campaigns.</p>
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
                <div><strong>{campaign.impressions || 0}</strong><span>Times shown</span></div>
                <div><strong>{campaign.clicks || 0}</strong><span>Taps</span></div>
                <div><strong>{formatMoney(campaign.totalPriceInCents || 0)}</strong><span>Stored total</span></div>
              </div>
              <div className="hub-actions-inline">
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadPayment(campaign._id)}>Payment details</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => runCampaignAction(campaign._id, 'pause')}>Pause</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => runCampaignAction(campaign._id, 'unpause')}>Unpause</button>
                <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => runCampaignAction(campaign._id, 'cancel')}>Cancel</button>
              </div>
            </article>
          ))}
        </div>
        <div className="hub-form-grid hub-form-grid--tight">
          <label className="hub-field">
            <span>Reason for your next campaign action</span>
            <input value={campaignAction.reason} onChange={(event) => setCampaignAction((current) => ({ ...current, reason: event.target.value }))} />
          </label>
          <label className="hub-field">
            <span>Extend by this many days</span>
            <input type="number" min="1" max="90" value={campaignAction.days} onChange={(event) => setCampaignAction((current) => ({ ...current, days: event.target.value }))} />
          </label>
          <label className="hub-field">
            <span>Partial refund amount in cents</span>
            <input type="number" min="0" value={campaignAction.amountInCents} onChange={(event) => setCampaignAction((current) => ({ ...current, amountInCents: event.target.value }))} />
          </label>
          <label className="hub-field">
            <span>Selected campaign</span>
            <input value={selectedCampaign || ''} onChange={(event) => setSelectedCampaign(event.target.value || null)} placeholder="Use Payment details or paste a campaign id" />
          </label>
          <div className="hub-actions-inline hub-field--full">
            <button type="button" className="btn btn-outline hub-btn-dark" disabled={!selectedCampaign} onClick={() => runCampaignAction(selectedCampaign, 'extend')}>Extend selected campaign</button>
            <button type="button" className="btn btn-outline hub-btn-dark" disabled={!selectedCampaign} onClick={() => runCampaignAction(selectedCampaign, 'refund')}>Refund selected campaign</button>
          </div>
        </div>
        {paymentDetail ? (
          <div className="hub-detail-card">
            <h3>Selected payment details</h3>
            <p><strong>Status:</strong> {paymentDetail.status || 'Unknown'}</p>
            <p><strong>Amount:</strong> {formatMoney(paymentDetail.amountInCents || 0)}</p>
            <p><strong>Processor:</strong> {paymentDetail.processor || 'Stripe'}</p>
            <p><strong>Created:</strong> {formatDateTime(paymentDetail.createdAt)}</p>
          </div>
        ) : null}
      </section>
      </section>

      <section className="hub-section-block">
        <div className="hub-section-heading">
          <p className="hub-section-kicker">Operations</p>
          <h2>Moderation and support queues</h2>
        </div>
      <div className="hub-grid hub-grid--balanced">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Playground moderation</h2>
              <p>Review pending playground additions, edits, and photos that need a decision.</p>
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
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadModeration(item.id || item._id)}>Open details</button>
                  <button type="button" className="btn btn-teal" onClick={() => moderatePlayground(item.id || item._id, 'approve')}>Approve</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => moderatePlayground(item.id || item._id, 'reject')}>Reject</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => moderatePlayground(item.id || item._id, 'retry')}>Retry</button>
                </div>
              </article>
            ))}
          </div>
          {moderationDetail ? (
            <div className="hub-detail-card">
              <h3>Selected moderation item</h3>
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
              <h2>Support queue and playground snapshot</h2>
              <p>Work through incoming support requests and keep an eye on the current playground data sample.</p>
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
              <h3>Playground snapshot</h3>
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
      </section>

      <section className="hub-section-block">
        <div className="hub-section-heading">
          <p className="hub-section-kicker">Playgrounds</p>
          <h2>Inspect live records and merge history</h2>
        </div>
      <div className="hub-grid hub-grid--balanced">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Browse playground records</h2>
              <p>Load active playgrounds, filter by name or city, then open the record and its merge history.</p>
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
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadPlaygroundDetail(String(playground.id || playground._id))}>Open record</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => archivePlayground(String(playground.id || playground._id))}>Archive</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Selected playground record</h2>
              <p>Inspect a real playground record and the merge history attached to it.</p>
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
      </section>
        </div>
      )}
    </div>
  );
}
