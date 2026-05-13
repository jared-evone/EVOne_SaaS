import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { WorkOrderProvider } from './workOrderStore';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkOrderProvider>
      <App />
    </WorkOrderProvider>
  </StrictMode>,
);
