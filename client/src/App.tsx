import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const eventSource = new EventSource('/api/logs/stream');

    eventSource.onmessage = (event) => {
      const newLog = JSON.parse(event.data);
      setLogs((prevLogs) => [...prevLogs, newLog]);
    };

    eventSource.onerror = (err) => {
      console.error('EventSource failed:', err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Logtrail</h1>
      </header>
      <div className="log-container">
        <pre>
          {logs.map((log, index) => (
            <div key={index}>{log}</div>
          ))}
        </pre>
      </div>
    </div>
  );
}

export default App;
