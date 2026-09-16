import { useEffect, useState } from 'react';
import FunctionalApp from './FunctionalApp';
import LandingPage from './LandingPage';
import AuthGate from './AuthGate';

type Screen = 'home' | 'platform';

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => window.location.hash.startsWith('#platform') ? 'platform' : 'home');

  useEffect(() => {
    const sync = () => setScreen(window.location.hash.startsWith('#platform') ? 'platform' : 'home');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const openPlatform = () => {
    window.location.hash = 'platform/decision-desk';
    setScreen('platform');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openHome = () => {
    history.pushState(null, '', window.location.pathname + window.location.search);
    setScreen('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (screen === 'platform') {
    return <div className='platform-root'>
      <AuthGate onExit={openHome}><FunctionalApp/></AuthGate>
    </div>;
  }

  return <LandingPage onExplore={openPlatform}/>;
}
