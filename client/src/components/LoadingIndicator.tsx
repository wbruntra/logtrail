import React from 'react'

interface LoadingIndicatorProps {
  message?: string
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ message = 'Loading older logs...' }) => {
  return (
    <div
      style={{ 
        textAlign: 'center', 
        fontSize: '0.9em', 
        color: '#888', 
        marginBottom: 8 
      }}
    >
      {message}
    </div>
  )
}

export default LoadingIndicator
