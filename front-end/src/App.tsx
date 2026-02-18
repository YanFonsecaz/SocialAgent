import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ChatInterface } from './components/ChatInterface';
import { StrategistInlinks } from './components/StrategistInlinks';

/** App principal com roteamento entre Social Agent e Strategist Inlinks. */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatInterface />} />
        <Route path="/strategist" element={<StrategistInlinks />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
