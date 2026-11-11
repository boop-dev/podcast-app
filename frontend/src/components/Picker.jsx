/* A styled replacement for the native <select>. Android draws a native select
 * as its own plain system dialog, which does not match the app; this opens a
 * bottom sheet in the app's own style, closes on back / outside tap, and returns
 * the option's original value (number or string). */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/back'
import Icon from './Icon'

export default function Picker({
  value,
  options, // [{ value, label }]
  onChange,
  title,
  ariaLabel,
  triggerClass = 'pick-pill',
  children, // custom trigger content; default is the current label + a chevron
}) {
  const [open, setOpen] = useState(false)
  useBackHandler(open, () => setOpen(false))
  const current = options.find((o) => String(o.value) === String(value))

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || title}
      >
        {children || (
          <>
            <span>{current ? current.label : ''}</span>
            <Icon name="chevronDown" size={16} />
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div className="picker-backdrop" onClick={() => setOpen(false)}>
            <div className="picker-sheet" role="listbox" aria-label={title} onClick={(e) => e.stopPropagation()}>
              <div className="picker-grab" />
              {title && <div className="picker-title">{title}</div>}
              <div className="picker-list">
                {options.map((o) => {
                  const selected = String(o.value) === String(value)
                  return (
                    <button
                      key={String(o.value)}
                      role="option"
                      aria-selected={selected}
                      className={selected ? 'on' : ''}
                      onClick={() => {
                        setOpen(false)
                        if (!selected) onChange(o.value)
                      }}
                    >
                      <span>{o.label}</span>
                      {selected && <Icon name="check" size={18} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
