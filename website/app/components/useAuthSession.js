'use client';

import { useEffect, useMemo, useState } from 'react';
import { HUB_AUTH_EVENT, loadHubSettings, readJwtClaims as readHubJwtClaims } from './hubClientUtils';
import { WEB_AUTH_EVENT, getAuthToken, readJwtClaims } from './webAuthClient';

function readSessionState() {
  const consumerToken = getAuthToken();
  const adminSettings = loadHubSettings('admin');
  const advertiserSettings = loadHubSettings('advertiser');
  const adminClaims = readHubJwtClaims(adminSettings.token);
  const consumerClaims = readJwtClaims(consumerToken);
  const fallbackClaims = readHubJwtClaims(advertiserSettings.token);
  const claims = consumerClaims || fallbackClaims;
  const isAdmin = Boolean(adminClaims?.admin || claims?.admin);
  const isLoggedIn = Boolean(consumerToken || advertiserSettings.token || adminSettings.token);

  return {
    token: consumerToken,
    claims,
    isAdmin,
    isLoggedIn,
  };
}

export default function useAuthSession() {
  const [session, setSession] = useState(readSessionState);

  useEffect(() => {
    function syncSession() {
      setSession(readSessionState());
    }
    window.addEventListener('storage', syncSession);
    window.addEventListener(HUB_AUTH_EVENT, syncSession);
    window.addEventListener(WEB_AUTH_EVENT, syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener(HUB_AUTH_EVENT, syncSession);
      window.removeEventListener(WEB_AUTH_EVENT, syncSession);
    };
  }, []);

  return useMemo(() => session, [session]);
}
