'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  clearSharedAuthSession,
  formatDateOnly,
  formatDateTime,
  getDefaultApiBase,
  hubFetch,
  loadHubSettings,
  readJwtClaims,
  saveSharedAuthSession,
  statusTone,
} from './hubClientUtils';
import HubAuthPanel from './HubAuthPanel';

const emptyOnboarding = {
  businessName: '',
  contactEmail: '',
  category: 'family_dining',
  city: '',
  state: '',
  websiteUrl: '',
  description: '',
  businessAddress: '',
};

const emptyDraft = {
  packageType: 'inline_listing',
  durationMonths: '1',
  targetingRadiusMiles: '20',
  startDate: '',
  headline: '',
  body: '',
  ctaText: 'Learn More',
  ctaUrl: '',
  creativeBusinessName: '',
  creativeBusinessCategory: '',
  showDistance: true,
  termsVersion: '1.0',
};

const categoryOptions = [
  'indoor_play',
  'outdoor_recreation',
  'family_dining',
  'education',
  'entertainment',
  'retail',
  'health_wellness',
  'services',
  'other',
];

const categoryLabels = {
  indoor_play: 'Indoor play',
  outdoor_recreation: 'Outdoor recreation',
  family_dining: 'Family dining',
  education: 'Education',
  entertainment: 'Entertainment',
  retail: 'Retail',
  health_wellness: 'Health and wellness',
  services: 'Services',
  other: 'Other',
};

const packageLabels = {
  featured_home: 'Featured home placement',
  inline_listing: 'Inline listing',
  event_spotlight_7d: '7-day event spotlight',
  event_spotlight_14d: '14-day event spotlight',
};

function AdPreviewCard({
  placement,
  isEvent,
  businessName,
  headline,
  body,
  ctaText,
  imageUrl,
  title = 'In-app preview',
  description,
  tone = 'draft',
}) {
  const isPrime = placement === 'featured_home';
  const displayBusinessName = businessName?.trim() || 'Your business';
  const displayHeadline = headline?.trim() || 'Your headline will appear here';
  const displayBody = body?.trim() || 'Your description will appear here once you add it.';
  const displayCta = ctaText?.trim() || 'Learn more';
  const previewLabel = description || (isPrime
    ? 'Prime placement preview: image on the left, message and button on the right.'
    : 'Inline listing preview: wide image on top, then the message and button underneath.');

  return (
    <div className="hub-draft-preview">
      <div className="hub-draft-preview__head">
        <div>
          <h3>{title}</h3>
          <p>{previewLabel}</p>
        </div>
        <span className={`hub-pill hub-pill--${tone === 'pending' ? 'warn' : isPrime ? 'good' : 'neutral'}`}>
          {isPrime ? 'Prime layout' : isEvent ? 'Event / inline layout' : 'Inline layout'}
        </span>
      </div>

      {isPrime ? (
        <article className="hub-ad-preview hub-ad-preview--prime" aria-label="Prime placement preview">
          <div className="hub-ad-preview__image hub-ad-preview__image--prime">
            {imageUrl ? <img src={imageUrl} alt="" /> : <span>Ad image</span>}
          </div>
          <div className="hub-ad-preview__content hub-ad-preview__content--prime">
            <div className="hub-ad-preview__copy">
              <h4>{displayBusinessName}</h4>
              <p>{displayBody}</p>
            </div>
            <div className="hub-ad-preview__footer">
              <span className={`hub-ad-preview__badge${isEvent ? ' hub-ad-preview__badge--event' : ''}`}>
                {isEvent ? 'Event' : 'Ad'}
              </span>
              <button type="button" className="hub-ad-preview__cta" disabled>{displayCta}</button>
            </div>
          </div>
        </article>
      ) : (
        <article className="hub-ad-preview hub-ad-preview--inline" aria-label="Inline listing preview">
          <div className="hub-ad-preview__image hub-ad-preview__image--inline">
            {imageUrl ? <img src={imageUrl} alt="" /> : <span>Wide ad image</span>}
          </div>
          <div className="hub-ad-preview__content hub-ad-preview__content--inline">
            <div className="hub-ad-preview__title-row">
              <h4>{displayHeadline}</h4>
              <span className={`hub-ad-preview__badge${isEvent ? ' hub-ad-preview__badge--event' : ''}`}>
                {isEvent ? 'Event' : 'Ad'}
              </span>
            </div>
            <p>{displayBody}</p>
            <button type="button" className="hub-ad-preview__cta hub-ad-preview__cta--full" disabled>{displayCta}</button>
          </div>
        </article>
      )}
    </div>
  );
}

function DraftPreviewCard({ draftForm, advertiser, imagePreviewUrl }) {
  return (
    <AdPreviewCard
      placement={draftForm.packageType}
      isEvent={draftForm.packageType.startsWith('event_')}
      businessName={draftForm.creativeBusinessName.trim() || advertiser?.businessName}
      headline={draftForm.headline}
      body={draftForm.body}
      ctaText={draftForm.ctaText}
      imageUrl={imagePreviewUrl}
    />
  );
}

export default function AdvertiserHubClient({ embedded = false }) {
  const [apiBase, setApiBase] = useState(getDefaultApiBase());
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [advertiser, setAdvertiser] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignDetail, setCampaignDetail] = useState(null);
  const [onboardingForm, setOnboardingForm] = useState(emptyOnboarding);
  const [draftForm, setDraftForm] = useState(emptyDraft);
  const [imageFile, setImageFile] = useState(null);
  const claims = readJwtClaims(token);
  const imagePreviewUrl = useMemo(() => {
    if (!imageFile) return '';
    return URL.createObjectURL(imageFile);
  }, [imageFile]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    const settings = loadHubSettings('advertiser');
    setApiBase(settings.apiBase);
    setToken(settings.token);
  }, []);

  async function runTask(task, successMessage) {
    setBusy(true);
    setError('');
    setMessage('');
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
    setMessage('Signed in successfully.');
    setError('');
    setTimeout(() => {
      refreshDashboard();
    }, 0);
  }

  function handleSignedOut() {
    setToken('');
    clearSharedAuthSession();
    setAdvertiser(null);
    setSubmissions([]);
    setCampaigns([]);
    setSelectedSubmission(null);
    setSelectedCampaign(null);
    setCampaignDetail(null);
    setMessage('Signed out.');
    setError('');
  }

  async function refreshDashboard() {
    await runTask(async () => {
      const [profileRes, submissionsRes, campaignsRes] = await Promise.all([
        hubFetch(apiBase, token, '/api/advertisers/me').catch((err) => {
          if (String(err.message).toLowerCase().includes('not found')) return { data: null };
          throw err;
        }),
        hubFetch(apiBase, token, '/api/ads/submissions/mine'),
        hubFetch(apiBase, token, '/api/ads/analytics/campaigns'),
      ]);
      setAdvertiser(profileRes.data || null);
      setSubmissions(submissionsRes.data || []);
      setCampaigns(campaignsRes.data || []);
      return true;
    }, 'Your advertising dashboard is up to date.');
  }

  async function createDraftSubmission(event) {
    event.preventDefault();
    const created = await runTask(async () => {
      const response = await hubFetch(apiBase, token, '/api/ads/submissions', {
        method: 'POST',
        body: JSON.stringify(onboardingForm),
      });
      return response.data;
    }, 'Business details saved. Your draft is ready for ad details.');
    if (created && created.submissionId) {
      const submissionId = String(created.submissionId);
      setSelectedSubmission(submissionId);
      await refreshDashboard();
    }
  }

  async function saveDraftSteps(event) {
    event.preventDefault();
    if (!selectedSubmission) {
      setError('Start a draft first, or choose one you already saved.');
      return;
    }

    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}`, {
        method: 'PUT',
        body: JSON.stringify({
          step: 2,
          packageType: draftForm.packageType,
          durationMonths: draftForm.packageType.startsWith('event_') ? undefined : Number(draftForm.durationMonths),
          targetingRadiusMiles: Number(draftForm.targetingRadiusMiles),
          startDate: draftForm.packageType.startsWith('event_') ? undefined : draftForm.startDate,
        }),
      });

      let imageUrl = null;
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        const upload = await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}/assets`, {
          method: 'POST',
          body: formData,
          isFormData: true,
          headers: {},
        });
        imageUrl = upload.data?.imageUrl || null;
      }

      await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}`, {
        method: 'PUT',
        body: JSON.stringify({
          step: 3,
          headline: draftForm.headline,
          body: draftForm.body,
          ctaText: draftForm.ctaText,
          ctaUrl: draftForm.ctaUrl,
          imageUrl,
          creativeBusinessName: draftForm.creativeBusinessName || undefined,
          creativeBusinessCategory: draftForm.creativeBusinessCategory || undefined,
          showDistance: draftForm.showDistance,
        }),
      });

      await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}`, {
        method: 'PUT',
        body: JSON.stringify({
          step: 5,
          termsVersion: draftForm.termsVersion,
        }),
      });
      setImageFile(null);
      await refreshDashboard();
      return true;
    }, 'Ad details saved.');
  }

  async function loadCampaignDetail(campaignId) {
    await runTask(async () => {
      const response = await hubFetch(apiBase, token, `/api/ads/analytics/campaigns/${campaignId}`);
      setSelectedCampaign(campaignId);
      setCampaignDetail(response.data || null);
      return true;
    });
  }

  async function cancelSubmission(submissionId) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/submissions/${submissionId}/prelaunch-cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refreshDashboard();
      return true;
    }, 'Draft cancelled before launch.');
  }

  async function deleteDraft(submissionId) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/submissions/${submissionId}`, {
        method: 'DELETE',
      });
      if (selectedSubmission === submissionId) setSelectedSubmission(null);
      await refreshDashboard();
      return true;
    }, 'Draft deleted.');
  }

  async function cancelCampaign(campaignId) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/campaigns/${campaignId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refreshDashboard();
      if (selectedCampaign === campaignId) {
        await loadCampaignDetail(campaignId);
      }
      return true;
    }, 'Campaign cancelled.');
  }

  return (
    <div className={`container hub-page${embedded ? ' hub-page--embedded' : ''}`}>
      {embedded ? (
        <section className="hub-inline-intro">
          <div>
            <p className="hub-eyebrow">Continue here</p>
            <h2>Build and manage your advertising</h2>
            <p className="hub-lead">
              Sign in, save your business details, create an ad, and keep up with campaign updates without leaving this page.
            </p>
          </div>
        </section>
      ) : (
        <section className={`hub-hero${token ? ' hub-hero--signed-in' : ''}`}>
          <div>
            <p className="hub-eyebrow">Advertiser tools</p>
            <h1>{token ? 'Your advertiser dashboard' : 'Advertiser Hub'}</h1>
            <p className="hub-lead">
              {token
                ? 'Manage your business details, draft new ads, request updates, and track campaign performance in one place.'
                : 'Set up your business profile, build an ad, and keep track of campaigns in one place.'}
            </p>
          </div>
          {!token ? (
            <div className="hub-tip-card">
              <h2>What you can do here</h2>
              <ul>
                <li>Tell us about your business</li>
                <li>Choose the kind of ad you want to run</li>
                <li>See how your campaigns are performing</li>
                <li>Send updates for review before they replace a live ad</li>
              </ul>
            </div>
          ) : null}
        </section>
      )}

      {!token ? (
        <HubAuthPanel
          apiBase={apiBase}
          token={token}
          onAuthenticated={handleAuthenticated}
          onSignedOut={handleSignedOut}
          audience="advertiser"
        />
      ) : null}

      {token ? (
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Your dashboard</h2>
              <p>Refresh to load your saved drafts, campaign updates, and any changes waiting on approval.</p>
              <p className="hub-dashboard-account">
                Signed in as <strong>{claims?.email || claims?.user_id || 'your account'}</strong>
              </p>
            </div>
            <div className="hub-actions-inline">
              <button type="button" className="btn btn-teal" disabled={busy} onClick={refreshDashboard}>Refresh</button>
            </div>
          </div>
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        </section>
      ) : null}

      {!token ? (
        <section className="hub-card">
          <h2>Sign in to get started</h2>
          <p className="hub-muted-copy">
            Once you sign in, you will be able to save your business details, build an ad, and track your campaigns here.
          </p>
        </section>
      ) : (
        <>
      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Business details</h2>
              <p>Start a new draft by telling us about your business.</p>
            </div>
          </div>
          <form className="hub-form-grid" onSubmit={createDraftSubmission}>
            {Object.entries(onboardingForm).map(([key, value]) => (
              key === 'description' || key === 'businessAddress' ? (
                <label className="hub-field hub-field--full" key={key}>
                  <span>{key === 'businessAddress' ? 'Business address' : 'Business description'}</span>
                  <textarea value={value} rows={key === 'description' ? 3 : 2} onChange={(event) => setOnboardingForm((current) => ({ ...current, [key]: event.target.value }))} />
                </label>
              ) : key === 'category' ? (
                <label className="hub-field" key={key}>
                  <span>Category</span>
                  <select value={value} onChange={(event) => setOnboardingForm((current) => ({ ...current, category: event.target.value }))}>
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>{categoryLabels[option] || option}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="hub-field" key={key}>
                  <span>
                    {key === 'contactEmail'
                      ? 'Contact email'
                      : key === 'businessName'
                        ? 'Business name'
                        : key === 'websiteUrl'
                          ? 'Website'
                          : key.charAt(0).toUpperCase() + key.replace(/([A-Z])/g, ' $1').slice(1)}
                  </span>
                  <input value={value} onChange={(event) => setOnboardingForm((current) => ({ ...current, [key]: event.target.value }))} />
                </label>
              )
            ))}
            <div className="hub-actions-inline hub-field--full">
              <button type="submit" className="btn btn-teal" disabled={busy}>Save business details</button>
            </div>
          </form>
          {advertiser ? (
            <div className="hub-summary">
              <div><strong>Current business:</strong> {advertiser.businessName}</div>
              <div><strong>Service area:</strong> {advertiser.regionKey || 'Not set yet'}</div>
              <div><strong>Status:</strong> <span className={`hub-pill hub-pill--${statusTone(advertiser.status)}`}>{advertiser.status || 'unknown'}</span></div>
            </div>
          ) : null}
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Ad details</h2>
              <p>Choose a saved draft, then add the ad type, timing, image, and message you want people to see. New and updated creative goes through review before it can appear.</p>
            </div>
          </div>
          <form className="hub-form-grid" onSubmit={saveDraftSteps}>
            <label className="hub-field">
              <span>Saved draft</span>
              <select value={selectedSubmission || ''} onChange={(event) => setSelectedSubmission(event.target.value || null)}>
                <option value="">Choose a draft</option>
                {submissions.map((submission) => (
                  <option key={submission._id} value={submission._id}>
                    {`${formatDateOnly(submission.updatedAt)} - ${submission.status || 'draft'}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="hub-field">
              <span>Ad type</span>
              <select value={draftForm.packageType} onChange={(event) => setDraftForm((current) => ({ ...current, packageType: event.target.value }))}>
                {Object.entries(packageLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="hub-field">
              <span>How long to run it</span>
              <select value={draftForm.durationMonths} onChange={(event) => setDraftForm((current) => ({ ...current, durationMonths: event.target.value }))}>
                <option value="1">1 month</option>
                <option value="2">2 months</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
              </select>
            </label>
            <label className="hub-field">
              <span>How far away people can see it</span>
              <select value={draftForm.targetingRadiusMiles} onChange={(event) => setDraftForm((current) => ({ ...current, targetingRadiusMiles: event.target.value }))}>
                <option value="20">20 miles</option>
                <option value="30">30 miles</option>
                <option value="40">40 miles</option>
                <option value="50">50 miles</option>
              </select>
            </label>
            <label className="hub-field">
              <span>Start date</span>
              <input type="date" value={draftForm.startDate} onChange={(event) => setDraftForm((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="hub-field hub-field--full">
              <span>Ad title</span>
              <input value={draftForm.headline} onChange={(event) => setDraftForm((current) => ({ ...current, headline: event.target.value }))} />
            </label>
            <label className="hub-field hub-field--full">
              <span>Ad description</span>
              <textarea rows={4} value={draftForm.body} onChange={(event) => setDraftForm((current) => ({ ...current, body: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Button label</span>
              <input value={draftForm.ctaText} onChange={(event) => setDraftForm((current) => ({ ...current, ctaText: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Button link</span>
              <input value={draftForm.ctaUrl} onChange={(event) => setDraftForm((current) => ({ ...current, ctaUrl: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Business name shown on the ad</span>
              <input value={draftForm.creativeBusinessName} onChange={(event) => setDraftForm((current) => ({ ...current, creativeBusinessName: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Business category shown on the ad</span>
              <select value={draftForm.creativeBusinessCategory} onChange={(event) => setDraftForm((current) => ({ ...current, creativeBusinessCategory: event.target.value }))}>
                <option value="">Use the main business category</option>
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>{categoryLabels[option] || option}</option>
                ))}
              </select>
            </label>
            <label className="hub-field">
              <span>Ad image</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setImageFile(event.target.files?.[0] || null)} />
            </label>
            <label className="hub-checkbox hub-field--full">
              <input type="checkbox" checked={draftForm.showDistance} onChange={(event) => setDraftForm((current) => ({ ...current, showDistance: event.target.checked }))} />
              <span>Show how far away the business is</span>
            </label>
            <div className="hub-field hub-field--full">
              <DraftPreviewCard
                draftForm={draftForm}
                advertiser={advertiser}
                imagePreviewUrl={imagePreviewUrl}
              />
            </div>
            <div className="hub-actions-inline hub-field--full">
              <button type="submit" className="btn btn-teal" disabled={busy}>Save ad details</button>
            </div>
          </form>
        </section>
      </div>

      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Saved drafts</h2>
              <p>Come back to unfinished ads, cancel them before launch, or remove drafts you no longer need.</p>
            </div>
          </div>
          <div className="hub-list">
            {submissions.length === 0 ? <p className="hub-empty">No submissions loaded yet.</p> : submissions.map((submission) => (
              <article key={submission._id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{submission._id}</h3>
                    <p>Step {submission.currentStep || 0} - Updated {formatDateTime(submission.updatedAt)}</p>
                  </div>
                  <span className={`hub-pill hub-pill--${statusTone(submission.status)}`}>{submission.status || 'unknown'}</span>
                </div>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => setSelectedSubmission(submission._id)}>Use this draft</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => cancelSubmission(submission._id)}>Cancel before launch</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => deleteDraft(submission._id)}>Delete draft</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Live and past campaigns</h2>
              <p>See how often your ad was shown, how often people tapped it, and which campaign is selected right now.</p>
            </div>
          </div>
          <div className="hub-list">
            {campaigns.length === 0 ? <p className="hub-empty">No campaigns loaded yet.</p> : campaigns.map((campaign) => (
              <article key={campaign._id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{campaign.businessName || campaign.headline || campaign._id}</h3>
                    <p>{campaign.targetedCityLabels?.join(', ') || 'No areas listed'} - {formatDateOnly(campaign.startDateCalendar)} to {formatDateOnly(campaign.endDateCalendar)}</p>
                  </div>
                  <span className={`hub-pill hub-pill--${statusTone(campaign.status)}`}>{campaign.status || 'unknown'}</span>
                </div>
                <div className="hub-stats-grid">
                  <div><strong>{campaign.impressions || 0}</strong><span>Times shown</span></div>
                  <div><strong>{campaign.clicks || 0}</strong><span>Taps</span></div>
                  <div><strong>{((campaign.ctr || 0) * 100).toFixed(1)}%</strong><span>Tap rate</span></div>
                </div>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadCampaignDetail(campaign._id)}>View results</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => cancelCampaign(campaign._id)}>Cancel campaign</button>
                </div>
              </article>
            ))}
          </div>
          {campaignDetail ? (
            <div className="hub-detail-card">
              <h3>Selected campaign</h3>
              <p><strong>Status:</strong> {campaignDetail.campaign?.status || 'Unknown'}</p>
              <p><strong>Where it appears:</strong> {campaignDetail.campaign?.placement || 'Not set'}</p>
              <p><strong>Areas included:</strong> {campaignDetail.campaign?.targetedCityLabels?.join(', ') || 'None'}</p>
              {campaignDetail.campaign?.creativePreview ? (
                <AdPreviewCard
                  title="Current live version"
                  description="This is the version people currently see in the app."
                  placement={campaignDetail.campaign?.placement || 'inline_listing'}
                  isEvent={Boolean(campaignDetail.campaign?.isEvent)}
                  businessName={campaignDetail.campaign?.creativePreview?.businessName}
                  headline={campaignDetail.campaign?.creativePreview?.headline}
                  body={campaignDetail.campaign?.creativePreview?.body}
                  ctaText={campaignDetail.campaign?.creativePreview?.ctaText}
                  imageUrl={campaignDetail.campaign?.creativePreview?.imageUrl}
                />
              ) : null}
              {campaignDetail.campaign?.pendingCreativePreview ? (
                <AdPreviewCard
                  title="Waiting on review"
                  description="These requested changes will not replace the live ad until approval."
                  placement={campaignDetail.campaign?.placement || 'inline_listing'}
                  isEvent={Boolean(campaignDetail.campaign?.isEvent)}
                  businessName={campaignDetail.campaign?.pendingCreativePreview?.businessName}
                  headline={campaignDetail.campaign?.pendingCreativePreview?.headline}
                  body={campaignDetail.campaign?.pendingCreativePreview?.body}
                  ctaText={campaignDetail.campaign?.pendingCreativePreview?.ctaText}
                  imageUrl={campaignDetail.campaign?.pendingCreativePreview?.imageUrl}
                  tone="pending"
                />
              ) : null}
              <div className="hub-stats-grid">
                <div><strong>{campaignDetail.analytics?.totals?.impressions || 0}</strong><span>Total times shown</span></div>
                <div><strong>{campaignDetail.analytics?.totals?.clicks || 0}</strong><span>Total taps</span></div>
                <div><strong>{((campaignDetail.analytics?.totals?.ctr || 0) * 100).toFixed(1)}%</strong><span>Overall tap rate</span></div>
              </div>
              <div className="hub-table-wrap">
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Times shown</th>
                      <th>Taps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(campaignDetail.analytics?.daily || []).map((row) => (
                      <tr key={row.ymd}>
                        <td>{row.ymd}</td>
                        <td>{row.impressions || 0}</td>
                        <td>{row.clicks || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      </div>
        </>
      )}
    </div>
  );
}
