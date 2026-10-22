import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import type { MobileLocale } from '../lib/mobile-i18n';
import {
  extractNotificationTapRoute,
  getSharedMobilePushRegistrationState,
  type NotificationTapRoute,
  resolveConfiguredEasProjectId,
  syncMobilePushRegistration,
  unregisterPushOnLogout,
} from '../lib/push-notifications';
import { fetchApi } from '../lib/supabase';

// Configure foreground notifications to show alert with sound enabled
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {
  // ignore in environments where native notification module is unavailable
}

function getRuntimeEasProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return resolveConfiguredEasProjectId({
    envProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    easConfigProjectId: Constants.easConfig?.projectId ?? null,
    expoConfigExtraProjectId: extra?.eas?.projectId ?? null,
  });
}

interface UseMobilePushNotificationsOptions {
  isLoggedIn: boolean;
  userId: string;
  activeShopId?: string;
  canViewOrders: boolean;
  locale: MobileLocale;
  onNotificationTapOrder: (route: NotificationTapRoute) => void;
}

export function useMobilePushNotifications({
  isLoggedIn,
  userId,
  activeShopId,
  canViewOrders,
  locale,
  onNotificationTapOrder,
}: UseMobilePushNotificationsOptions) {
  const registrationStateRef = useRef(getSharedMobilePushRegistrationState());
  const onTapRef = useRef(onNotificationTapOrder);
  onTapRef.current = onNotificationTapOrder;

  // Acquire token and register for the active shop (when user has orders.view),
  // with bounded retry on transient network/API failure and foreground recovery.
  useEffect(() => {
    if (!isLoggedIn || !userId || !activeShopId || !canViewOrders) {
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const MAX_RETRY_ATTEMPTS = 3;

    const projectId = getRuntimeEasProjectId();
    if (!projectId) {
      return;
    }

    const runRegistrationSync = async () => {
      if (cancelled) return;
      try {
        await syncMobilePushRegistration({
          state: registrationStateRef.current,
          isLoggedIn,
          userId,
          activeShopId,
          canViewOrders,
          locale,
          projectId,
          adapter: {
            platform: Platform.OS,
            getPermissionsAsync: () => Notifications.getPermissionsAsync(),
            requestPermissionsAsync: () =>
              Notifications.requestPermissionsAsync(),
            getExpoPushTokenAsync: (opts) =>
              Notifications.getExpoPushTokenAsync(opts),
            setNotificationChannelAsync: (channelId, config) =>
              Notifications.setNotificationChannelAsync(channelId, config),
          },
          apiCall: fetchApi,
          isCancelled: () => cancelled,
        });
        retryAttempt = 0;
      } catch {
        // Retry registration after transient network/API errors without blocking UI
        if (!cancelled && retryAttempt < MAX_RETRY_ATTEMPTS) {
          retryAttempt += 1;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            void runRegistrationSync();
          }, 5000);
        }
      }
    };

    void runRegistrationSync();

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && !cancelled) {
        retryAttempt = 0;
        void runRegistrationSync();
      }
    };
    const appStateSubscription = AppState.addEventListener(
      'change',
      handleAppStateChange
    );

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      appStateSubscription.remove();
    };
  }, [isLoggedIn, userId, activeShopId, canViewOrders, locale]);

  // Listen for notification taps (both cold-start last response and live tap listener)
  useEffect(() => {
    if (!isLoggedIn || Platform.OS === 'web') return;

    let alive = true;
    const handleResponse = (
      response: Notifications.NotificationResponse | null
    ) => {
      if (!alive || !response) return;
      const route = extractNotificationTapRoute(response);
      if (route) {
        onTapRef.current(route);
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    };

    Notifications.getLastNotificationResponseAsync()
      .then((initial) => {
        handleResponse(initial);
      })
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleResponse(response);
      }
    );

    return () => {
      alive = false;
      subscription.remove();
    };
  }, [isLoggedIn]);

  const handleUnregisterPushOnLogout = useCallback(
    async (
      signOut?: () => Promise<{ error?: { message?: string } | null } | void>
    ) => {
      return unregisterPushOnLogout({
        state: registrationStateRef.current,
        apiCall: fetchApi,
        signOut,
      });
    },
    []
  );

  return {
    unregisterPushOnLogout: handleUnregisterPushOnLogout,
  };
}
