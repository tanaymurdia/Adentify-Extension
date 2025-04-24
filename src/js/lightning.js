// Lightning Effect on Canvas
function initLightningCanvas() {
    const canvas = document.getElementById('lightning-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Resize handler
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        ctx.scale(dpr, dpr);
    }
    window.addEventListener('resize', resize);
    resize();
    // Recursive fractal bolt drawer
    function drawBolt(x1, y1, x2, y2, displace) {
        if (displace < 1) {
            ctx.lineTo(x2, y2);
        } else {
            const midX = (x1 + x2) / 2 + (Math.random() * 2 - 1) * displace;
            const midY = (y1 + y2) / 2 + (Math.random() * 2 - 1) * displace;
            drawBolt(x1, y1, midX, midY, displace / 2);
            drawBolt(midX, midY, x2, y2, displace / 2);
        }
    }
    // Fire a single lightning strike
    function strike() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        const startX = Math.random() * w;
        ctx.moveTo(startX, 0);
        drawBolt(startX, 0, startX, h, w / 2);
        // Core grad
        const coreGrad = ctx.createLinearGradient(startX, 0, startX, h);
        coreGrad.addColorStop(0, 'rgba(80,0,0,1)');
        coreGrad.addColorStop(1, 'rgba(60,0,0,0.7)');
        ctx.save(); ctx.strokeStyle = coreGrad; ctx.lineWidth = 2;
        ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(60,0,0,1)'; ctx.stroke(); ctx.restore();
        // Outline grad
        const outlineGrad = ctx.createLinearGradient(startX, 0, startX, h);
        outlineGrad.addColorStop(0, 'rgba(60,0,0,1)');
        outlineGrad.addColorStop(1, 'rgba(40,0,0,0.7)');
        ctx.save(); ctx.strokeStyle = outlineGrad; ctx.lineWidth = 0.5;
        ctx.shadowBlur = 5; ctx.shadowColor = 'rgba(40,0,0,0.8)'; ctx.stroke(); ctx.restore();
        setTimeout(() => ctx.clearRect(0, 0, w, h), 1000);
    }
    // Schedule repeated strikes
    function schedule() {
        const delay = 1000 + Math.random() * 2000;
        setTimeout(() => {
            const count = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < count; i++) {
                setTimeout(strike, i * 100);
            }
            schedule();
        }, delay);
    }
    setTimeout(() => {
        strike();
        schedule();
    }, 1000);
}

document.addEventListener('DOMContentLoaded', initLightningCanvas); 