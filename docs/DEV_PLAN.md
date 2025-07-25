# Development Plan: Logtrail Application

This document outlines the steps to build a web-based log monitoring application.

## ✅ Phase 1: Core File Monitoring Service & API (COMPLETED)

1.  **File Watching Module:**
    *   ✅ Create a Node.js module that can watch a given file for changes, specifically for new lines being appended.
    *   ✅ This module will be the core of the real-time monitoring feature.

2.  **Log Simulation Script:**
    *   ✅ Develop a script to periodically append new lines to `test/log.txt`. This will serve as a mock log generator for testing purposes.

3.  **Express.js Streaming API:**
    *   ✅ Set up an Express.js server with an endpoint like `/api/logs/stream`.
    *   ✅ This endpoint will use Server-Sent Events (SSE) to stream file changes to the connected client.
    *   🔄 Implement a configuration mechanism to define a list of monitorable log files for security and clarity.

## ✅ Phase 2: Basic Frontend React Application (COMPLETED)

1.  **Real-time Log Viewer:**
    *   ✅ Implement a component to display the log stream.
    *   ✅ Use the `EventSource` API to connect to the backend's streaming endpoint and display the data as it arrives.

2.  **Basic UI:**
    *   ✅ Create a simple interface to display streaming logs.

---

## 🚀 Phase 3: Configuration Management & Multi-File Support


1.  **Configuration System:**
    *   ✅ Create a configuration file (YAML) to define available log files
    *   ✅ Include file paths, display names, and (optionally) descriptions
    *   ⏳ Implement hot-reload of configuration changes

2.  **File Selection UI:**
    *   ✅ Add a dropdown/selector to choose which log file to monitor
    *   ⏳ Display file metadata (size, last modified, etc.)
    *   ⏳ Show connection status for each monitored file

3.  **Multi-File Monitoring:**
    *   ✅ Support simultaneous monitoring of multiple files (user can select any configured file)
    *   ⏳ Implement tabbed interface or split-view for multiple logs
    *   ⏳ Color-code or label different log sources

## 🎨 Phase 4: Enhanced User Experience


1.  **Log Formatting & Parsing:**
    *   ✅ Implement log level detection (ERROR, WARN, INFO, DEBUG)
    *   ⏳ Add syntax highlighting for different log formats (JSON, structured logs)
    *   ⏳ Support for timestamp parsing and formatting
    *   ✅ Log output window is full width and soft wraps lines (no horizontal scroll)

2.  **Search & Filtering:**
    *   ✅ Real-time search functionality across log content
    *   ✅ Filter by log level, time range, or custom patterns
    *   ✅ Regex support for advanced filtering

3.  **UI/UX Improvements:**
    *   Professional styling with CSS frameworks (Tailwind, Material-UI)
    *   Dark/light theme toggle
    *   Responsive design for mobile devices
    *   ✅ Auto-scroll toggle with manual scroll lock detection (floating pause/play button)

## 📊 Phase 5: Advanced Features

1.  **Historical Log Viewing:**
    *   ✅ Load and display last N lines of log content (tail on file select)
    *   ⏳ **Automatic History Loading on Scroll Up:**
        - **Frontend Implementation:**
          * Detect when user scrolls near the top of the log container (e.g., within 100px)
          * Maintain a "loading" state to prevent multiple simultaneous requests
          * Track current "offset" or "before" timestamp for pagination
          * When loading older logs, prepend them to the existing log array
          * Preserve scroll position after prepending (calculate and restore scroll offset)
          * Show loading indicator at the top when fetching older logs
          * Handle edge case when reaching the beginning of the file
        - **Backend Implementation:**
          * Create `/api/logs/history` endpoint with pagination parameters:
            - `file`: log file path
            - `before`: timestamp or line number to fetch logs before
            - `limit`: number of lines to return (default 100)
          * Implement efficient file reading that can start from a specific position
          * For large files, use file streaming with reverse reading or index-based approach
          * Return response with: `{ lines: [...], hasMore: boolean, nextBefore: "..." }`
          * Support both line-number-based and timestamp-based pagination
        - **Optimizations:**
          * Cache recently loaded chunks on frontend to avoid re-fetching
          * Implement virtual scrolling for very large log sets
          * Add debouncing to scroll events to prevent excessive API calls
    *   ⏳ **Enhanced Pagination Controls:**
        - Add manual "Load More" button as fallback
        - Jump to specific timestamp or line number
        - "Go to beginning/end" buttons
    *   ⏳ **File Position Tracking:**
        - Track current position in file (percentage, line number)
        - Show position indicator in UI
        - Persist position when switching between files

2.  **Log Analytics:**
    *   Basic metrics dashboard (error rates, log frequency)
    *   Pattern detection and alerts
    *   Export functionality (filtered logs to file)

3.  **Performance Optimization:**
    *   Virtual scrolling for large log volumes
    *   Configurable buffer limits to prevent memory issues
    *   WebSocket fallback for SSE connection issues

## 🔧 Phase 6: System Integration & Deployment

1.  **System Integration:**
    *   Support for log rotation detection
    *   Integration with common log formats (syslog, application logs)
    *   Optional file permission validation

2.  **Security & Access Control:**
    *   Basic authentication system
    *   File access permissions and sandboxing
    *   Rate limiting for API endpoints

3.  **Deployment & DevOps:**
    *   Docker containerization
    *   Environment-based configuration
    *   Production build optimization
    *   Health check endpoints

## 🚀 Phase 7: Advanced Monitoring Features

1.  **Alerting System:**
    *   Pattern-based alerts (error keywords, thresholds)
    *   Email/webhook notifications
    *   Alert history and management

2.  **Distributed Logging:**
    *   Support for remote log sources
    *   Log aggregation from multiple servers
    *   Central dashboard for multiple instances

3.  **Advanced Analytics:**
    *   Log trend analysis
    *   Performance metrics visualization
    *   Custom dashboard creation
