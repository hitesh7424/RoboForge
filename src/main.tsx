import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import App from './App.tsx';
import './index.css';

// @react-three/fiber v9.x instantiates THREE.Clock internally, which emits a deprecation
// warning in Three.js r187+. Keep all other Three.js warnings/errors active.
THREE.setConsoleFunction((type, message, ...params) => {
  if (type === 'warn' && message.includes('THREE.Clock')) {
    return;
  }
  if (type === 'error') {
    console.error(message, ...params);
  } else if (type === 'warn') {
    console.warn(message, ...params);
  } else {
    console.log(message, ...params);
  }
});

createRoot(document.getElementById('root')!).render(<App />);
