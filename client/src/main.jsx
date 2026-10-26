import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource-variable/schibsted-grotesk';
import './styles.css';
import { isNative } from './lib/platform.js';

if (isNative) {
  document.documentElement.classList.add('native');
  // Android hardware back button: go back in the app, or close it from the home screen.
  import('@capacitor/app').then(({ App: CapApp }) => {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      const modalClose = document.querySelector('.overlay .close');
      if (modalClose) modalClose.click();
      else if (canGoBack && location.pathname !== '/') history.back();
      else CapApp.exitApp();
    });
  });
} else if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
