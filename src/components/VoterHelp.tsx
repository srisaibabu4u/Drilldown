import { useEffect, useState, type FormEvent } from 'react'
import type { Booth } from '../booths'
import type { Voter } from '../voters'
import { createRequest, errorText, listRequests, STATUS_LABEL, type HelpRequest } from '../team'

/**
 * On a voter's card, for leads whose area includes this station: this person's
 * scheme-help requests, and a form to record a new one (consent required).
 */
export default function VoterHelp({ booth, voter }: { booth: Booth; voter: Voter }) {
  const [rows, setRows] = useState<HelpRequest[] | null>(null)
  const [schemes, setSchemes] = useState<{ code: string; name: string }[]>([])
  const [adding, setAdding] = useState(false)
  const [scheme, setScheme] = useState('')
  const [need, setNeed] = useState('')
  const [mobile, setMobile] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = () =>
    listRequests({ voter: `${booth.id}:${voter.serial}`, limit: 20 })
      .then((r) => {
        setRows(r.rows)
        setSchemes(r.schemes)
      })
      .catch((e) => setError(errorText(e)))

  useEffect(() => {
    setRows(null)
    setAdding(false)
    setSaved(false)
    setError('')
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booth.id, voter.serial])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createRequest({
        boothId: booth.id,
        voterSerial: voter.serial,
        voterRef: voter.id,
        voterName: voter.name,
        scheme,
        need,
        mobile: mobile.trim() || undefined,
        consent,
      })
      setAdding(false)
      setScheme('')
      setNeed('')
      setMobile('')
      setConsent(false)
      setSaved(true)
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="voter-help">
      <h4>Scheme help</h4>
      {rows === null && !error && <p className="muted small">Loading…</p>}
      {rows && rows.length === 0 && !adding && <p className="muted small">No help requests for this person.</p>}
      {rows && rows.length > 0 && (
        <ul className="help-mini">
          {rows.map((r) => (
            <li key={r.id}>
              <span className={`status-pill st-${r.status}`}>{STATUS_LABEL[r.status]}</span>
              <span>
                <b>{r.scheme_name}</b> — {r.need}
              </span>
            </li>
          ))}
        </ul>
      )}
      {saved && !adding && <p className="ok-note small">Saved. Your ward / mandal lead can see it in Help requests.</p>}

      {!adding ? (
        <button className="ghost help-add" onClick={() => setAdding(true)}>
          + Needs help with a scheme
        </button>
      ) : (
        <form className="help-form" onSubmit={submit}>
          <label>
            Scheme
            <select className="legend-select" value={scheme} onChange={(e) => setScheme(e.target.value)} required>
              <option value="">Choose a scheme…</option>
              {schemes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            What help is needed
            <textarea
              className="search"
              rows={3}
              maxLength={500}
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              placeholder="e.g. Pension stopped, needs re-verification documents"
              required
            />
          </label>
          <label>
            Mobile (optional)
            <input
              className="search"
              inputMode="numeric"
              pattern="[6-9][0-9]{9}"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              placeholder="10-digit mobile"
            />
          </label>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              The person agreed to share these details so we can help them apply. <span className="muted">(Recorded with today’s date.)</span>
            </span>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="help-actions">
            <button type="button" className="ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="primary" disabled={busy || !consent || !scheme || need.trim().length < 3}>
              {busy ? 'Saving…' : 'Save request'}
            </button>
          </div>
        </form>
      )}
      {error && !adding && <p className="form-error small">{error}</p>}
    </section>
  )
}
