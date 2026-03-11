import { useState, useRef, useEffect } from 'react'

const SWATCHES = [
  // Greens
  '#1E5C3A', '#2D7A4F', '#4A9B6E', '#7BBF94',
  // Blues
  '#1E4D6B', '#2B6B91', '#3D8FB5', '#6AAFD4',
  // Browns/Earth
  '#5C3B1E', '#7A5233', '#9E7255', '#C4A07A',
  // Reds/Terracotta
  '#7A2316', '#A33A25', '#C45A3A', '#D98A70',
  // Ambers/Ochre
  '#6B4F10', '#9A7318', '#C49A30', '#E0C060',
  // Purples
  '#3D2458', '#5C3D7A', '#7D5E9E', '#A898C4',
  // Neutral darks
  '#1C1612', '#3A3430', '#6A6460', '#9A9490',
  // Neutrals light
  '#C8C0B4', '#DDD8CE', '#F0EBE2', '#FFFFFF',
]

export function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [hex,  setHex]  = useState(value || '')
  const ref = useRef(null)

  useEffect(() => { setHex(value || '') }, [value])

  useEffect(() => {
    function handleClick(e) {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleHexInput(e) {
    const v = e.target.value
    setHex(v)
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v)
  }

  function handleSwatchClick(color) {
    setHex(color)
    onChange(color)
    setOpen(false)
  }

  const isValid = /^#[0-9A-Fa-f]{6}$/.test(hex)

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-2">
        {/* Swatch button */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-8 h-8 rounded border-2 border-border flex-shrink-0 transition-colors hover:border-primary"
          style={{ backgroundColor: isValid ? hex : 'transparent' }}
          title="Pick color"
        >
          {!isValid && <span className="text-muted-foreground text-xs w-full h-full flex items-center justify-center">?</span>}
        </button>
        {/* Hex input */}
        <input
          type="text"
          value={hex}
          onChange={handleHexInput}
          placeholder="#000000"
          maxLength={7}
          className="w-28 bg-background border border-border rounded text-xs text-foreground px-2 py-1.5 focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
        />
      </div>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded-md shadow-lg p-3 w-[192px]">
          <div className="grid grid-cols-8 gap-1">
            {SWATCHES.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => handleSwatchClick(color)}
                className="w-5 h-5 rounded-sm border border-border/50 hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <input
              type="color"
              value={isValid ? hex : '#000000'}
              onChange={e => { setHex(e.target.value); onChange(e.target.value) }}
              className="w-full h-7 rounded border border-border cursor-pointer bg-background"
            />
          </div>
        </div>
      )}
    </div>
  )
}
