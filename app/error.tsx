'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  console.error('[Glev] App error:', error)
  return (
    <div style={{
      minHeight: '100vh', background: '#09090B', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: '#111117', border: '1px solid rgba(255,0,0,0.2)',
        borderRadius: 16, padding: 32, maxWidth: 480, width: '100%',
      }}>
        <div style={{ fontSize: 13, color: '#FF2D78', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12 }}>
          APP ERROR
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
        <pre style={{
          fontSize: 12, color: 'rgba(255,255,255,0.45)', background: 'rgba(0,0,0,0.3)',
          borderRadius: 8, padding: '10px 14px', overflowX: 'auto', marginBottom: 20,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {error.message || 'Unknown error'}
        </pre>
        <button
          onClick={reset}
          style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: '#4F6EF7', color: '#fff', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
