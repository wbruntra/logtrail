
import { useState, useEffect, useRef } from 'react';
import './App.scss';


function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logFiles, setLogFiles] = useState<{ name: string; path: string; description?: string }[]>([]);
  const [selectedLog, setSelectedLog] = useState<string>('');
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  // Fetch log file list on mount
  useEffect(() => {
    fetch('/api/logs/list')
      .then((res) => res.json())
      .then((data) => {
        setLogFiles(data.logs || []);
        if (data.logs && data.logs.length > 0) {
          setSelectedLog(data.logs[0].path);
        }
      });
  }, []);

  // Fetch last 100 lines and connect to log stream when selectedLog changes
  useEffect(() => {
    if (!selectedLog) return;
    setLogs([]);
    if (eventSource) {
      eventSource.close();
    }
    // Fetch last 100 lines first
    fetch(`/api/logs/tail?file=${encodeURIComponent(selectedLog)}&lines=100`)
      .then((res) => res.json())
      .then((data) => {
        let initialLines: string[] = [];
        if (data && typeof data.lines === 'string') {
          initialLines = data.lines.split(/\r?\n/).filter(Boolean);
        }
        setLogs(initialLines);
        // Now start the live stream
        const es = new EventSource(`/api/logs/stream?file=${encodeURIComponent(selectedLog)}`);
        es.onmessage = (event) => {
          const newLog = JSON.parse(event.data);
          setLogs((prevLogs) => [...prevLogs, newLog]);
        };
        es.onerror = (err) => {
          console.error('EventSource failed:', err);
          es.close();
        };
        setEventSource(es);
      });
    // Cleanup
    return () => {
      if (eventSource) eventSource.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLog]);

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect user scroll to disable auto-scroll if user scrolls up
  const handleScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
    setAutoScroll(atBottom);
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="container">
          <h1 className="display-5 mb-3">Logtrail</h1>
          <div className="mb-3">
            <label htmlFor="log-select" className="form-label me-2">Select log file:</label>
            <select
              id="log-select"
              className="form-select d-inline-block w-auto"
              value={selectedLog}
              onChange={(e) => setSelectedLog(e.target.value)}
            >
              {logFiles.map((log) => (
                <option key={log.path} value={log.path}>
                  {log.name} {log.description ? `- ${log.description}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <div className="main-content">
        <div
          className="log-container"
          ref={logContainerRef}
          onScroll={handleScroll}
        >
          <pre className="mb-0">
            {logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
          </pre>
          <button
            className={`autoscroll-toggle btn btn-${autoScroll ? 'secondary' : 'primary'}`}
            title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            onClick={() => {
              if (!autoScroll && logContainerRef.current) {
                logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
              }
              setAutoScroll((v) => !v);
            }}
          >
            {autoScroll ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <rect x="3" y="2" width="3" height="12" rx="1"/>
                <rect x="10" y="2" width="3" height="12" rx="1"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <polygon points="3,2 14,8 3,14" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
