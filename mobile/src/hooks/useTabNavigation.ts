import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { TabType } from '../styles/mobileStyles';

interface UseTabNavigationOptions {
  hasOpenModal: boolean;
  onCloseModal: () => void;
}

export function useTabNavigation({
  hasOpenModal,
  onCloseModal,
}: UseTabNavigationOptions) {
  const [activeTab, setActiveTabState] = useState<TabType>('orders');
  const [tabHistory, setTabHistory] = useState<TabType[]>(['orders']);
  const [mountedTabs, setMountedTabs] = useState<Record<TabType, boolean>>({
    orders: true,
    overview: false,
    catalog: false,
    promotions: false,
    settings: false,
  });

  const navigateTab = useCallback((nextTab: TabType) => {
    setMountedTabs((prev) =>
      prev[nextTab] ? prev : { ...prev, [nextTab]: true }
    );
    setActiveTabState((curr) => {
      if (curr === nextTab) return curr;
      setTabHistory((stack) => {
        const filtered = stack.filter((t) => t !== nextTab);
        return [...filtered, nextTab];
      });
      return nextTab;
    });
  }, []);

  // Handle Android hardware Back button with real tab history back-stack
  useEffect(() => {
    const onBackPress = () => {
      if (hasOpenModal) {
        onCloseModal();
        return true;
      }

      if (tabHistory.length > 1) {
        const nextStack = tabHistory.slice(0, -1);
        const previousTab = nextStack[nextStack.length - 1] || 'orders';
        setTabHistory(nextStack);
        setActiveTabState(previousTab);
        return true;
      }

      if (activeTab !== 'orders') {
        setActiveTabState('orders');
        setTabHistory(['orders']);
        return true;
      }

      return false;
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress
    );
    return () => subscription.remove();
  }, [activeTab, tabHistory, hasOpenModal, onCloseModal]);

  return {
    activeTab,
    navigateTab,
    mountedTabs,
  };
}
