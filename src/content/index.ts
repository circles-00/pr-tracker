import { extension } from '../platform/extension';
import { storage } from '../platform/storage';
import { SidebarLayoutTracker } from './sidebar-layout';
import { ToastStackController } from './toast-stack';
import { TokenHandoffController } from './token-handoff';
import { WatchButtonController } from './watch-button';

interface NavigationApi {
  addEventListener(type: 'navigatesuccess', listener: () => void): void;
  removeEventListener(type: 'navigatesuccess', listener: () => void): void;
}

function getNavigationApi(): NavigationApi | null {
  const nav = (window as unknown as { navigation?: NavigationApi }).navigation;
  return nav && typeof nav.addEventListener === 'function' ? nav : null;
}

function init(): void {
  const layout = new SidebarLayoutTracker();
  const watchButton = new WatchButtonController(layout);
  const tokenHandoff = new TokenHandoffController();
  const toastStack = new ToastStackController(layout);
  const nav = getNavigationApi();

  let lastPath = '';

  const teardown = (): void => {
    unsubscribeStorage();
    if (nav) nav.removeEventListener('navigatesuccess', handleRouteChange);
    window.removeEventListener('popstate', handleRouteChange);
    watchButton.destroy();
    tokenHandoff.destroy();
    toastStack.destroy();
    layout.stop();
  };

  const handleRouteChange = (): void => {
    if (!extension.isContextValid()) {
      teardown();
      return;
    }

    if (location.pathname === lastPath) return;

    lastPath = location.pathname;
    watchButton.onRouteChange();
    tokenHandoff.onRouteChange();
  };

  const unsubscribeStorage = storage.onChanged((changes) => {
    if (!extension.isContextValid()) {
      teardown();
      return;
    }

    watchButton.onStorageChanged(changes);
    void toastStack.onStorageChanged(changes);
  });

  if (nav) nav.addEventListener('navigatesuccess', handleRouteChange);
  window.addEventListener('popstate', handleRouteChange);

  handleRouteChange();
}

init();
