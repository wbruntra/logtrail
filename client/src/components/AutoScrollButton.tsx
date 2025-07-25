import React from 'react'

interface AutoScrollButtonProps {
  autoScroll: boolean
  onToggle: () => void
}

const AutoScrollButton: React.FC<AutoScrollButtonProps> = ({ autoScroll, onToggle }) => {
  return (
    <button
      className={`autoscroll-toggle btn btn-${autoScroll ? 'secondary' : 'primary'}`}
      title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
      onClick={onToggle}
    >
      {autoScroll ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <rect x="3" y="2" width="3" height="12" rx="1" />
          <rect x="10" y="2" width="3" height="12" rx="1" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <polygon points="3,2 14,8 3,14" />
        </svg>
      )}
    </button>
  )
}

export default AutoScrollButton
