// QR Code Generator with TrendAI branding
// Uses qrcode library with custom colors and logo overlay

const QRGenerator = (() => {
  const TREND_RED = '#d71920';
  const BG_COLOR = '#000000';
  const LOGO_SIZE_RATIO = 0.22; // Logo takes ~22% of QR width

  // TrendAI "T" logo as SVG data URL
  function getLogoDataUrl() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="12" fill="${TREND_RED}"/>
      <text x="32" y="46" text-anchor="middle" font-family="Arial,sans-serif"
            font-size="40" font-weight="bold" fill="white">T</text>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Generate branded QR code as data URL
  async function generate(payload, size) {
    size = size || 280;
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Generate base QR using qrcode library (loaded as global QRCode)
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, json, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'H', // High EC for logo overlay
      color: {
        dark: TREND_RED,
        light: BG_COLOR,
      },
    });

    // Overlay logo in center
    const ctx = canvas.getContext('2d');
    const logoSize = Math.floor(size * LOGO_SIZE_RATIO);
    const logoX = Math.floor((size - logoSize) / 2);
    const logoY = Math.floor((size - logoSize) / 2);

    // White background behind logo for contrast
    const pad = 4;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(logoX - pad, logoY - pad, logoSize + pad * 2, logoSize + pad * 2);

    const logo = await loadImage(getLogoDataUrl());
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);

    return canvas.toDataURL('image/png');
  }

  return { generate, TREND_RED, BG_COLOR };
})();
