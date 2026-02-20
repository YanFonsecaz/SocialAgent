import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ChatInterface } from "./components/ChatInterface";
import { StrategistInlinks } from "./components/StrategistInlinks";
import { TrendsMaster } from "./components/TrendsMaster";

/** App principal com roteamento entre Social Agent e Strategist Inlinks. */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatInterface />} />
        <Route path="/strategist" element={<StrategistInlinks />} />
        <Route path="/trends-master" element={<TrendsMaster />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
