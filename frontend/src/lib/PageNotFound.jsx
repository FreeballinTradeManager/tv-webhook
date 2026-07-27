import { Link } from 'react-router-dom'

export default function PageNotFound() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-2">404</h1>
        <p className="text-slate-400 mb-6">This page doesn&apos;t exist.</p>
        <Link to="/" className="text-blue-400 hover:text-blue-300">← Back to Dashboard</Link>
      </div>
    </div>
  )
}
