// THE TRAVERSE COMPONENTS PANEL — CPQ's panel (Shared/TraverseConfiguratorModal), its questions in its order: how the curtain opens, the
// motor side on a motor, the carriers, the components, the accessories — and what is still needed, said, never refused. One panel for the
// portal's two doors (2026-10-20): the Configure walk's Traverse step draws the server's view of it; Quick Ship's traverse kit draws the
// same shape worked out on the page from the kit's chart (Shared/traverseConfigurator — the module tab 7's popup runs).
//
// `t` = { drive, feet, tracks, draws, motorSides, carrierStyles, picks, accessories, missing } (each part { id, name, sku, unit }), `sel` the
// answers that stand, `onSel(patch, isTyping)` with `patch(base) → the fields that change`, `fmtMoney` the page's money words.
import React from 'react';

export default function TraversePanel({ t, sel, onSel, fmtMoney }) {
  if (!t) return <div className="cf-note">The track's components are set from our chart for this length.</div>;
  const countOf = (map, id) => Number(((sel[map] || {})[id]) || 0);
  const style = t.carrierStyles.find((c) => c.id === sel.carrierStyle) || null;
  const typedCarriers = parseInt(sel.carrierQty, 10) || 0;
  return (
    <div className="cf-trv">
      <div className="cf-fine">{t.drive === 'MOTORIZED' ? 'Motorized' : 'Manual'} · {t.feet} ft · {t.tracks === 2 ? 'two tracks' : 'one track'} — the drive decides which components there are; what this length needs is included, and raising a count adds the difference.</div>
      <div className="cf-q">
        <div className="cf-q-label">Draw direction — how the curtain opens</div>
        <div className="cf-rows">
          {t.draws.map((d) => (
            <label key={d.value} className={`cf-radio${sel.draw === d.value ? ' on' : ''}`} data-draw={d.value}>
              <input type="radio" name="trv-draw" checked={sel.draw === d.value} onChange={() => onSel(() => ({ draw: d.value }))} />
              <span><span className="cf-radio-label">{d.label}</span><span className="cf-fine">{d.hint}</span></span>
            </label>
          ))}
        </div>
        {!sel.draw && <div className="cf-fine cf-need">Required — the track is assembled to it.</div>}
      </div>
      {t.motorSides.length > 0 && (
        <div className="cf-q">
          <div className="cf-q-label">Motor side</div>
          <div className="cf-rows">
            {t.motorSides.map((m) => (
              <label key={m.value} className={`cf-radio${sel.motorSide === m.value ? ' on' : ''}`} data-motor-side={m.value}>
                <input type="radio" name="trv-motor-side" checked={sel.motorSide === m.value} onChange={() => onSel(() => ({ motorSide: m.value }))} />
                <span className="cf-radio-label">{m.label}</span>
              </label>
            ))}
          </div>
          {!sel.motorSide && <div className="cf-fine cf-need">Required on a motorized track — the head end is built to it.</div>}
        </div>
      )}
      <div className="cf-q">
        <div className="cf-q-label">Carrier style — pick one; {t.feet} ft includes the chart's count</div>
        <div className="cf-rows">
          {t.carrierStyles.map((c) => (
            <label key={c.id} className={`cf-radio${sel.carrierStyle === c.id ? ' on' : ''}`} data-carrier={c.id}>
              <input type="radio" name="trv-carrier" checked={sel.carrierStyle === c.id} onChange={() => onSel(() => ({ carrierStyle: c.id, carrierQty: '' }))} />
              <span><span className="cf-radio-label">{c.label}</span><span className="cf-fine">{c.id}{c.sku ? ` · ${c.sku}` : ''} — {c.included} included</span></span>
            </label>
          ))}
        </div>
        {style && (
          <label className="cf-count">
            <span>{style.defaultQty < style.included ? `How many (empty = ${style.defaultQty} for this length · up to ${style.included} included)` : `How many (empty = the chart's ${style.included})`}</span>
            <input value={sel.carrierQty || ''} inputMode="numeric" placeholder={String(style.defaultQty)} onChange={(e) => onSel(() => ({ carrierQty: e.target.value.replace(/[^0-9]/g, '') }), true)} />
            {typedCarriers > style.included && <span className="cf-fine">+{typedCarriers - style.included} over the chart{style.unit ? ` × ${fmtMoney(style.unit)}` : ''}</span>}
          </label>
        )}
      </div>
      <div className="cf-q">
        <div className="cf-q-label">Components — end stops are 2 per track; the chart says what this length includes</div>
        <div className="cf-rows">
          {t.picks.map((pk) => {
            const q = countOf('picks', pk.id);
            const on = q > 0;
            const note = pk.included === null || pk.included === undefined ? ''
              : pk.included > 0 ? `included at ${t.feet} ft (chart ${pk.included}${q > pk.included ? `; +${q - pk.included}${pk.unit ? ` × ${fmtMoney(pk.unit)}` : ''}` : ''})`
                : `not included at ${t.feet} ft${pk.unit ? ` — ${fmtMoney(pk.unit)} each` : ''}`;
            const seed = pk.included > 0 ? pk.included : 1;
            return (
              <label key={pk.id} className={`cf-check${on ? ' on' : ''}`} data-pick={pk.id}>
                <input type="checkbox" checked={on} onChange={(e) => onSel((b) => ({ picks: { ...(b.picks || {}), [pk.id]: e.target.checked ? (pk.endStop ? 2 * Math.max(1, t.tracks || 1) : seed) : 0 } }))} />
                <span className="cf-check-text"><span className="cf-radio-label">{pk.name}</span><span className="cf-fine">{pk.id}{pk.sku ? ` · ${pk.sku}` : ''}</span>{note && <span className="cf-fine">{note}</span>}</span>
                {on && <input className="cf-qty" value={q} inputMode="numeric" onClick={(e) => e.preventDefault()} onChange={(e) => onSel((b) => ({ picks: { ...(b.picks || {}), [pk.id]: Math.max(1, parseInt(e.target.value, 10) || 1) } }), true)} />}
              </label>
            );
          })}
        </div>
      </div>
      {t.accessories.length > 0 && (
        <div className="cf-q">
          <div className="cf-q-label">Accessories</div>
          <div className="cf-rows">
            {t.accessories.map((ac) => {
              const q = countOf('accessories', ac.id);
              const on = q > 0;
              return (
                <label key={ac.id} className={`cf-check${on ? ' on' : ''}`} data-accessory={ac.id}>
                  <input type="checkbox" checked={on} onChange={(e) => onSel((b) => ({ accessories: { ...(b.accessories || {}), [ac.id]: e.target.checked ? 1 : 0 } }))} />
                  <span className="cf-check-text"><span className="cf-radio-label">{ac.name}</span><span className="cf-fine">{ac.id}{ac.sku ? ` · ${ac.sku}` : ''}{ac.unit ? ` — ${fmtMoney(ac.unit)}` : ''}</span></span>
                  {on && <input className="cf-qty" value={q} inputMode="numeric" onClick={(e) => e.preventDefault()} onChange={(e) => onSel((b) => ({ accessories: { ...(b.accessories || {}), [ac.id]: Math.max(1, parseInt(e.target.value, 10) || 1) } }), true)} />}
                </label>
              );
            })}
          </div>
        </div>
      )}
      {t.missing.length > 0 && <div className="cf-note warn">Still needed: {t.missing.join(' · ')} — the rest is priced, but a track missing any of these is not a finished configuration. You can still add it to your request; our team will confirm it with you.</div>}
    </div>
  );
}
