/** UI Components for XHE Popular Skills */
import React from 'react'

export function IWINProgress({ progress }: any) {
  return (
    <div className="iwin-progress">
      <h3>♾️ I-WIN Mode Active</h3>
      <p>Iteration: {progress.iteration} | Status: {progress.status}</p>
      <p>Approach: {progress.currentApproach}</p>
    </div>
  )
}

export function MADDiscussion({ agents, messages }: any) {
  return (
    <div className="mad-discussion">
      <h3>🏛️ M.A.D. Multi-Agent Discussion</h3>
      <div>{agents?.map((a: any) => <span key={a.id}>{a.name} ({a.model})</span>)}</div>
      <div>{messages?.map((m: any, i: number) => <p key={i}>{m.content}</p>)}</div>
    </div>
  )
}

export function BYOKManager({ keys }: any) {
  return (
    <div className="byok-manager">
      <h3>🔑 BYOK - Bring Your Own Key</h3>
      <div>{keys?.map((k: any) => <div key={k.id}>{k.provider}: {k.model}</div>)}</div>
    </div>
  )
}
