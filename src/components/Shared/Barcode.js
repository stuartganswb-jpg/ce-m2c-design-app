import React from 'react';

// Self-contained Code 39 barcode renderer — no external dependency. Code 39 is alphanumeric,
// self-checking, and universally scannable, which fits our Sales Order numbers (e.g. "SO10293").
// Each character is 9 modules (5 bars + 4 spaces) with exactly 3 wide; '*' frames start/stop.
const C39 = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001',
  '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100',
  'A': '100001001', 'B': '001001001', 'C': '101001000', 'D': '000011001', 'E': '100011000',
  'F': '001011000', 'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
  'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011', 'O': '100010010',
  'P': '001010010', 'Q': '000000111', 'R': '100000110', 'S': '001000110', 'T': '000010110',
  'U': '110000001', 'V': '011000001', 'W': '111000000', 'X': '010010001', 'Y': '110010000',
  'Z': '011010000', '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100',
};

const Barcode = ({ value = '', height = 46, moduleWidth = 2, color = 'var(--ink, #1c1a16)', showText = true }) => {
  const raw = String(value).toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
  if (!raw) return null;
  const framed = `*${raw}*`;
  const wide = moduleWidth * 3, narrow = moduleWidth;
  const bars = [];
  let x = 0;
  for (let ci = 0; ci < framed.length; ci++) {
    const pat = C39[framed[ci]] || C39['*'];
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === '1' ? wide : narrow;
      if (i % 2 === 0) bars.push(<rect key={`${ci}-${i}`} x={x} y={0} width={w} height={height} fill={color} />);
      x += w;
    }
    x += narrow; // inter-character narrow gap
  }
  const totalW = x;
  const totalH = height + (showText ? 18 : 0);
  return (
    <svg width={totalW} height={totalH} viewBox={`0 0 ${totalW} ${totalH}`} shapeRendering="crispEdges" role="img" aria-label={`Barcode ${raw}`} style={{ maxWidth: '100%' }}>
      {bars}
      {showText && (
        <text x={totalW / 2} y={totalH - 4} textAnchor="middle" fontFamily="var(--mono, monospace)" fontSize="11" letterSpacing="3" fill={color}>{raw}</text>
      )}
    </svg>
  );
};

export default Barcode;
