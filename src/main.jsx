import { createRoot } from 'react-dom/client';
import './storage-client.js';
import './app.css';
import CoachCommandCenter from '../coach-command-center.jsx';

createRoot(document.getElementById('root')).render(<CoachCommandCenter />);
